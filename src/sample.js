import os from "node:os";
import { createWindowsDiskReader } from "./disk.js";
import { summarizeLocalDisks } from "./diskuse.js";
import { swapInUse } from "./format.js";
import { readProcessBlock } from "./processes.js";
import { rateFromCounters } from "./rates.js";

/**
 * @typedef {object} CpuSample
 * @property {number} percent
 * @property {number[] | null} [cores]
 *
 * @typedef {object} RamSample
 * @property {number} percent
 * @property {number} used
 * @property {number} total
 *
 * @typedef {object} SwapSample
 * @property {number} percent
 * @property {number} used
 * @property {number} total
 *
 * @typedef {object} DiskSample
 * @property {number | null} readBps
 * @property {number | null} writeBps
 *
 * @typedef {object} NetSample
 * @property {number | null} txBps
 * @property {number | null} rxBps
 *
 * @typedef {object} GpuSample
 * @property {number | null} percent
 * @property {number | null} used
 * @property {number | null} total
 * @property {number | null} [tempC]
 * @property {number | null} [powerW]
 *
 * @typedef {object} ProcUse
 * @property {string} name
 * @property {number} [percent]
 * @property {number} [mem]
 *
 * @typedef {object} ProcessBlock
 * @property {ProcUse[]} cpu
 * @property {ProcUse[]} ram
 * @property {ProcUse[] | null} gpu
 *
 * @typedef {object} Snapshot
 * @property {number} ts
 * @property {string} hostname
 * @property {string} osName
 * @property {number} physical
 * @property {number} logical
 * @property {number} ramTotal
 * @property {CpuSample | null} cpu
 * @property {RamSample | null} ram
 * @property {DiskSample | null} disk
 * @property {NetSample | null} net
 * @property {GpuSample | null} gpu
 * @property {SwapSample | null} swap
 * @property {ProcessBlock | null} processes
 * @property {{ percent: number, used: number, total: number, mount: string }[] | null} diskUse
 */

/**
 * @param {number | null | undefined} n
 */
function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/**
 * @param {import("systeminformation").OsData | null} info
 */
export function shortOsName(info) {
  const distro = String(info?.distro || "").trim();
  if (/windows\s*11/i.test(distro) || (info == null && os.type() === "Windows_NT" && windowsLabel(os.release()) === "Windows 11")) {
    return "Windows 11";
  }
  if (/windows\s*10/i.test(distro)) return "Windows 10";
  if (/windows/i.test(distro) || os.type() === "Windows_NT") {
    return windowsLabel(os.release());
  }
  if (!info) return os.type() || "unknown";
  const release = String(info.release || "").trim();
  if (distro && release && !distro.includes(release)) {
    const combined = `${distro} ${release}`.trim();
    if (combined.length <= 24) return combined;
  }
  if (distro) return distro.length <= 24 ? distro : distro.slice(0, 24);
  if (info.platform) return String(info.platform);
  return "unknown";
}

/**
 * @param {string} release
 */
function windowsLabel(release) {
  const major = Number(String(release).split(".")[0]);
  if (major >= 10) {
    const build = Number(String(release).split(".")[2] || 0);
    if (build >= 22000) return "Windows 11";
    return "Windows 10";
  }
  return "Windows";
}

/**
 * Sync snapshot from `os` only — first paint must not wait on PowerShell / nvidia-smi.
 * @returns {Snapshot}
 */
export function instantSnapshot() {
  const logical = Math.max(os.cpus().length, 1);
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    ts: Date.now(),
    hostname: os.hostname(),
    osName: shortOsName(null),
    physical: logical,
    logical,
    ramTotal: total,
    cpu: null,
    ram: total > 0 ? { percent: Math.min(100, (used / total) * 100), used, total } : null,
    disk: { readBps: null, writeBps: null },
    net: { txBps: null, rxBps: null },
    gpu: null,
    swap: null,
    processes: null,
    diskUse: null,
  };
}

function ramFromOs(ramTotal) {
  const total = ramTotal || os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  if (total <= 0) return null;
  return {
    percent: Math.min(100, Math.max(0, (used / total) * 100)),
    used,
    total,
  };
}

/**
 * GPU memory fields in systeminformation are sometimes MiB, sometimes bytes.
 * @param {number | null} n
 * @param {number | null} vramMb
 */
export function gpuBytes(n, vramMb) {
  if (n != null && n >= 256 * 1024 * 1024) return n;
  if (n != null && n > 0) return n * 1024 * 1024;
  if (vramMb != null && vramMb > 0) return vramMb * 1024 * 1024;
  return null;
}

/**
 * @param {Array<{ utilizationGpu?: number, memoryUsed?: number, memoryTotal?: number, vram?: number, temperatureGpu?: number, powerDraw?: number }>} controllers
 * @returns {GpuSample | null}
 */
export function pickGpu(controllers) {
  if (!Array.isArray(controllers) || controllers.length === 0) return null;
  /** @type {GpuSample[]} */
  const usable = [];
  for (const c of controllers) {
    const util = num(c.utilizationGpu);
    const used = gpuBytes(num(c.memoryUsed), null);
    const total = gpuBytes(num(c.memoryTotal), null);
    if (util == null && (used == null || total == null)) continue;
    const temp = num(c.temperatureGpu);
    const power = num(c.powerDraw);
    usable.push({
      percent: util ?? 0,
      used,
      total,
      tempC: temp != null && temp > 0 ? temp : null,
      powerW: power != null && power >= 0 ? power : null,
    });
  }
  if (usable.length === 0) return null;
  usable.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  return usable[0];
}

/**
 * Keep last good per-row values when a metric throws or returns null.
 * GPU stays null (omit row) until a usable sample appears.
 *
 * @param {Snapshot | null} last
 * @param {Partial<Snapshot> & { ts: number }} next
 * @returns {Snapshot}
 */
export function mergeLastGood(last, next) {
  const base = last || {
    ts: next.ts,
    hostname: "localhost",
    osName: "unknown",
    physical: 0,
    logical: 0,
    ramTotal: 0,
    cpu: null,
    ram: null,
    disk: null,
    net: null,
    gpu: null,
    swap: null,
    processes: null,
    diskUse: null,
  };
  return {
    ts: next.ts,
    hostname: next.hostname ?? base.hostname,
    osName: next.osName ?? base.osName,
    physical: next.physical ?? base.physical,
    logical: next.logical ?? base.logical,
    ramTotal: next.ramTotal ?? base.ramTotal,
    cpu: next.cpu ?? base.cpu,
    ram: next.ram ?? base.ram,
    disk: mergePair(next.disk, base.disk, "readBps", "writeBps"),
    net: mergePair(next.net, base.net, "txBps", "rxBps"),
    gpu: next.gpu ?? base.gpu,
    swap: next.swap ?? base.swap,
    processes: next.processes ?? base.processes,
    diskUse: next.diskUse ?? base.diskUse,
  };
}

/**
 * @param {Record<string, number | null> | null | undefined} next
 * @param {Record<string, number | null> | null | undefined} last
 * @param {string} a
 * @param {string} b
 */
function mergePair(next, last, a, b) {
  if (!next && !last) return null;
  if (!next) return last;
  return {
    [a]: next[a] ?? last?.[a] ?? null,
    [b]: next[b] ?? last?.[b] ?? null,
  };
}

/**
 * @param {os.CpuInfo} cpu
 * @param {boolean} windows
 */
export function cpuTimes(cpu, windows) {
  const t = cpu.times;
  const irq = t.irq || 0;
  const sys = windows ? Math.max(0, (t.sys || 0) - irq) : t.sys || 0;
  const idle = t.idle || 0;
  const total = (t.user || 0) + (t.nice || 0) + sys + irq + idle;
  return { idle, total };
}

/**
 * @param {os.CpuInfo[]} cpus
 */
export function cpuIdleTotal(cpus, windows = process.platform === "win32") {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const part = cpuTimes(c, windows);
    idle += part.idle;
    total += part.total;
  }
  return { idle, total };
}

/**
 * @param {os.CpuInfo[]} cpus
 */
export function cpuCoreTotals(cpus, windows = process.platform === "win32") {
  return (Array.isArray(cpus) ? cpus : []).map((c) => cpuTimes(c, windows));
}

/**
 * @param {{ idle: number, total: number } | null} prev
 * @param {{ idle: number, total: number }} curr
 */
export function cpuPercentFromDelta(prev, curr) {
  if (!prev) return null;
  const idle = curr.idle - prev.idle;
  const total = curr.total - prev.total;
  if (total <= 0) return null;
  const pct = (1 - idle / total) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, pct));
}

/**
 * @param {Array<{ iface?: string, rx_bytes?: number, tx_bytes?: number, operstate?: string, internal?: boolean }>} stats
 */
const VIRTUAL_IFACE =
  /^(lo|lo0)$|Loopback|vEthernet|Hyper-V|WSL|Bluetooth|Virtual|VPN|TAP|TUN|Tailscale|Pseudo|isatap|Teredo/i;

/**
 * @param {string} name
 */
export function isVirtualIface(name) {
  return VIRTUAL_IFACE.test(String(name || ""));
}

export function sumNetBytes(stats) {
  let rx = 0;
  let tx = 0;
  let any = false;
  if (!Array.isArray(stats)) return { rx: null, tx: null };
  for (const n of stats) {
    const name = String(n.iface || "");
    if (n.internal || isVirtualIface(name)) continue;
    if (n.operstate && n.operstate !== "up") continue;
    const r = num(n.rx_bytes);
    const t = num(n.tx_bytes);
    if (r == null && t == null) continue;
    any = true;
    rx += r ?? 0;
    tx += t ?? 0;
  }
  if (!any) return { rx: null, tx: null };
  return { rx, tx };
}

/**
 * @param {{ cpu?: Function, currentLoad?: Function, mem?: Function, osInfo?: Function, fsStats?: Function, networkStats?: Function, graphics?: Function, processes?: Function }} [si]
 * @param {{ full?: boolean, processes?: boolean }} [opts]
 */
export function createSampler(si, opts = {}) {
  /** @type {null | { idle: number, total: number }} */
  let prevCpu = null;
  /** @type {{ idle: number, total: number }[] | null} */
  let prevCores = null;
  /** @type {null | { rx: number, wx: number }} */
  let prevDisk = null;
  /** @type {null | { rx: number, tx: number }} */
  let prevNet = null;
  /** @type {number | null} */
  let prevTs = null;
  /** @type {Snapshot | null} */
  let last = null;
  /** @type {{ hostname: string, osName: string, physical: number, logical: number, ramTotal: number }} */
  let meta = (() => {
    const s = instantSnapshot();
    return {
      hostname: s.hostname,
      osName: s.osName,
      physical: s.physical,
      logical: s.logical,
      ramTotal: s.ramTotal,
    };
  })();
  let staticStarted = false;
  /** @type {GpuSample | null} */
  let gpuCache = null;
  let gpuStarted = false;
  /** @type {Snapshot["diskUse"]} */
  let diskUseCache = null;
  let diskUseStarted = false;
  /** @type {SwapSample | null} */
  let swapCache = null;
  let swapStarted = false;
  /** @type {ProcessBlock | null} */
  let procCache = null;
  let procStarted = false;
  const wantSwap = Boolean(opts.full);
  const wantProc = Boolean(opts.processes);
  const win32 = process.platform === "win32";
  const winDisk = win32 ? createWindowsDiskReader() : null;
  winDisk?.start();
  let winReady = false;
  prevCores = cpuCoreTotals(os.cpus());
  prevCpu = prevCores.reduce(
    (sum, core) => ({ idle: sum.idle + core.idle, total: sum.total + core.total }),
    { idle: 0, total: 0 },
  );

  async function loadSi() {
    if (si) return si;
    const mod = await import("systeminformation");
    return mod.default ?? mod;
  }

  function kickStatic(lib) {
    if (staticStarted) return;
    staticStarted = true;
    (async () => {
      try {
        const info = await lib.osInfo();
        meta = { ...meta, osName: shortOsName(info) };
      } catch {
        // keep fallback
      }
      try {
        const cpu = await lib.cpu();
        if (cpu?.physicalCores) meta = { ...meta, physical: cpu.physicalCores };
        if (cpu?.cores) meta = { ...meta, logical: cpu.cores };
      } catch {
        // keep os.cpus() counts
      }
    })();
  }

  async function sampleCpu() {
    const coresNow = cpuCoreTotals(os.cpus());
    const curr = coresNow.reduce(
      (sum, core) => ({ idle: sum.idle + core.idle, total: sum.total + core.total }),
      { idle: 0, total: 0 },
    );
    const pct = cpuPercentFromDelta(prevCpu, curr);
    const corePct =
      prevCores && prevCores.length === coresNow.length
        ? coresNow.map((core, i) => cpuPercentFromDelta(prevCores[i], core) ?? 0)
        : null;
    prevCpu = curr;
    prevCores = coresNow;
    if (pct == null) return null;
    return { percent: pct, cores: corePct };
  }

  async function sampleRam(lib, ramTotal) {
    if (win32) return ramFromOs(ramTotal);
    try {
      const mem = await lib.mem();
      const total = num(mem?.total) ?? ramTotal;
      const available = num(mem?.available) ?? num(mem?.free);
      let used = null;
      if (total != null && available != null) used = Math.max(0, total - available);
      else used = num(mem?.used) ?? num(mem?.active);
      if (used == null || total == null || total <= 0) return ramFromOs(ramTotal);
      return {
        percent: Math.min(100, Math.max(0, (used / total) * 100)),
        used,
        total,
      };
    } catch {
      return ramFromOs(ramTotal);
    }
  }

  /**
   * @param {number} ts
   * @param {{ rx: number, wx: number } | null} win
   */
  async function sampleDisk(lib, ts, win) {
    let rx = win ? num(win.rx) : null;
    let wx = win ? num(win.wx) : null;
    if (rx == null && wx == null && !win32) {
      try {
        const fs = await lib.fsStats();
        rx = num(fs?.rx);
        wx = num(fs?.wx);
      } catch {
        // ignore
      }
    }
    if (rx == null && wx == null) return { readBps: null, writeBps: null };
    const readBps = rateFromCounters(prevDisk?.rx, rx ?? prevDisk?.rx ?? 0, prevTs, ts);
    const writeBps = rateFromCounters(prevDisk?.wx, wx ?? prevDisk?.wx ?? 0, prevTs, ts);
    prevDisk = { rx: rx ?? 0, wx: wx ?? 0 };
    return { readBps, writeBps };
  }

  /**
   * @param {number} ts
   * @param {{ netRx?: number, netTx?: number } | null} win
   */
  async function sampleNet(lib, ts, win) {
    let rx = win ? num(win.netRx) : null;
    let tx = win ? num(win.netTx) : null;
    if (rx == null && tx == null && !win32) {
      try {
        const stats = await lib.networkStats("*");
        const summed = sumNetBytes(Array.isArray(stats) ? stats : stats ? [stats] : []);
        rx = summed.rx;
        tx = summed.tx;
      } catch {
        return { txBps: null, rxBps: null };
      }
    }
    const rxBps = rateFromCounters(prevNet?.rx, rx, prevTs, ts);
    const txBps = rateFromCounters(prevNet?.tx, tx, prevTs, ts);
    if (rx != null && tx != null) prevNet = { rx, tx };
    return { txBps, rxBps };
  }

  function kickGpu(lib) {
    if (gpuStarted) return;
    gpuStarted = true;
    lib
      .graphics()
      .then((g) => {
        gpuCache = pickGpu(g?.controllers || []);
      })
      .catch(() => {
        gpuCache = null;
      })
      .finally(() => {
        gpuStarted = false;
      });
  }

  function kickSwap(lib) {
    if (!wantSwap || swapStarted || typeof lib.mem !== "function") return;
    swapStarted = true;
    lib
      .mem()
      .then((mem) => {
        const total = num(mem?.swaptotal);
        const used = num(mem?.swapused);
        if (total == null || used == null || !swapInUse(used, total)) {
          swapCache = null;
          return;
        }
        swapCache = {
          percent: Math.min(100, Math.max(0, (used / total) * 100)),
          used,
          total,
        };
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          swapStarted = false;
        }, 15000);
      });
  }

  function kickProcesses(lib) {
    if (!wantProc || procStarted || typeof lib.processes !== "function") return;
    procStarted = true;
    readProcessBlock(lib)
      .then((block) => {
        if (block) procCache = block;
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          procStarted = false;
        }, 2000);
      });
  }

  function kickDiskUse(lib) {
    if (diskUseStarted) return;
    diskUseStarted = true;
    lib
      .fsSize()
      .then((rows) => {
        diskUseCache = summarizeLocalDisks(rows);
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          diskUseStarted = false;
        }, 15000);
      });
  }

  return {
    /**
     * @returns {Promise<Snapshot>}
     */
    async sample() {
      const lib = await loadSi();
      kickStatic(lib);
      kickGpu(lib);
      kickDiskUse(lib);
      kickSwap(lib);
      kickProcesses(lib);
      const win = winDisk ? await winDisk.read(winReady ? 400 : 50).catch(() => null) : null;
      if (win) winReady = true;
      const ts = Date.now();
      const [cpu, ram, disk, net] = await Promise.all([
        sampleCpu().catch(() => last?.cpu ?? null),
        sampleRam(lib, meta.ramTotal).catch(() => last?.ram ?? null),
        sampleDisk(lib, ts, win).catch(() => last?.disk ?? { readBps: null, writeBps: null }),
        sampleNet(lib, ts, win).catch(() => last?.net ?? { txBps: null, rxBps: null }),
      ]);
      prevTs = ts;
      const snap = mergeLastGood(last, {
        ts,
        ...meta,
        cpu,
        ram,
        disk,
        net,
        gpu: gpuCache,
        swap: swapCache,
        processes: procCache,
        diskUse: diskUseCache,
      });
      last = snap;
      return snap;
    },
    close() {
      winDisk?.close();
    },
  };
}
