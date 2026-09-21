import os from "node:os";
import { createWindowsDiskReader } from "./disk.js";
import { rateFromCounters } from "./rates.js";

/**
 * @typedef {object} CpuSample
 * @property {number} percent
 *
 * @typedef {object} RamSample
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
 * @param {Array<{ utilizationGpu?: number, memoryUsed?: number, memoryTotal?: number, vram?: number }>} controllers
 * @returns {GpuSample | null}
 */
export function pickGpu(controllers) {
  if (!Array.isArray(controllers) || controllers.length === 0) return null;
  const usable = controllers.filter((c) => {
    const util = num(c.utilizationGpu);
    const total = gpuBytes(num(c.memoryTotal), num(c.vram));
    const used = gpuBytes(num(c.memoryUsed), null);
    return util != null || (total != null && total > 0) || used != null;
  });
  if (usable.length === 0) return null;
  const c =
    usable.find((x) => num(x.utilizationGpu) != null) || usable[0];
  const percent = num(c.utilizationGpu);
  const total = gpuBytes(num(c.memoryTotal), num(c.vram));
  const used = gpuBytes(num(c.memoryUsed), null);
  return {
    percent,
    used,
    total,
  };
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
 * @param {os.CpuInfo[]} cpus
 */
export function cpuIdleTotal(cpus) {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    const i = t.idle || 0;
    const sum = (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0) + i;
    idle += i;
    total += sum;
  }
  return { idle, total };
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
export function sumNetBytes(stats) {
  let rx = 0;
  let tx = 0;
  let any = false;
  if (!Array.isArray(stats)) return { rx: null, tx: null };
  for (const n of stats) {
    const name = String(n.iface || "");
    if (n.internal || name === "lo" || name === "lo0" || /^Loopback/i.test(name)) {
      continue;
    }
    if (n.operstate && n.operstate !== "up" && n.operstate !== "unknown") {
      continue;
    }
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
 * @param {{ cpu?: Function, currentLoad?: Function, mem?: Function, osInfo?: Function, fsStats?: Function, networkStats?: Function, graphics?: Function }} [si]
 */
export function createSampler(si) {
  /** @type {null | { idle: number, total: number }} */
  let prevCpu = null;
  /** @type {null | { rx: number, wx: number }} */
  let prevDisk = null;
  /** @type {null | { rx: number, tx: number }} */
  let prevNet = null;
  /** @type {number | null} */
  let prevTs = null;
  /** @type {Snapshot | null} */
  let last = null;
  /** @type {Promise<{ hostname: string, osName: string, physical: number, logical: number, ramTotal: number }> | null} */
  let staticP = null;
  const winDisk = process.platform === "win32" ? createWindowsDiskReader() : null;

  async function loadSi() {
    if (si) return si;
    const mod = await import("systeminformation");
    return mod.default ?? mod;
  }

  async function loadStatic() {
    const lib = await loadSi();
    const hostname = os.hostname();
    let osName = shortOsName(null);
    let logical = Math.max(os.cpus().length, 1);
    let physical = logical;
    let ramTotal = os.totalmem();
    try {
      const info = await lib.osInfo();
      osName = shortOsName(info);
    } catch {
      // keep fallback
    }
    try {
      const cpu = await lib.cpu();
      if (cpu?.physicalCores) physical = cpu.physicalCores;
      if (cpu?.cores) logical = cpu.cores;
    } catch {
      // keep os.cpus() counts
    }
    try {
      const mem = await lib.mem();
      if (mem?.total) ramTotal = mem.total;
    } catch {
      // keep os.totalmem
    }
    return { hostname, osName, physical, logical, ramTotal };
  }

  async function sampleCpu(lib) {
    const curr = cpuIdleTotal(os.cpus());
    if (!prevCpu) {
      prevCpu = curr;
      await new Promise((r) => setTimeout(r, 50));
      const curr2 = cpuIdleTotal(os.cpus());
      const pctFast = cpuPercentFromDelta(prevCpu, curr2);
      prevCpu = curr2;
      if (pctFast != null) return { percent: pctFast };
    } else {
      const pct = cpuPercentFromDelta(prevCpu, curr);
      prevCpu = curr;
      if (pct != null) return { percent: pct };
    }
    try {
      const load = await lib.currentLoad();
      const pct = num(load?.currentLoad);
      if (pct != null) return { percent: Math.min(100, Math.max(0, pct)) };
    } catch {
      // keep n/a
    }
    return null;
  }

  async function sampleRam(lib, ramTotal) {
    try {
      const mem = await lib.mem();
      const total = num(mem?.total) ?? ramTotal;
      const used = num(mem?.used) ?? num(mem?.active);
      if (used == null || total == null || total <= 0) return null;
      return {
        percent: Math.min(100, Math.max(0, (used / total) * 100)),
        used,
        total,
      };
    } catch {
      const total = ramTotal || os.totalmem();
      const free = os.freemem();
      const used = total - free;
      if (total <= 0) return null;
      return {
        percent: Math.min(100, Math.max(0, (used / total) * 100)),
        used,
        total,
      };
    }
  }

  async function sampleDisk(lib, ts) {
    let rx = null;
    let wx = null;
    try {
      const fs = await lib.fsStats();
      rx = num(fs?.rx);
      wx = num(fs?.wx);
    } catch {
      // Windows fsStats is always null; fall through
    }
    if (rx == null && wx == null && winDisk) {
      const w = await winDisk.read();
      if (w) {
        rx = w.rx;
        wx = w.wx;
      }
    }
    if (rx == null && wx == null) return { readBps: null, writeBps: null };
    const readBps = rateFromCounters(prevDisk?.rx, rx ?? prevDisk?.rx ?? 0, prevTs, ts);
    const writeBps = rateFromCounters(prevDisk?.wx, wx ?? prevDisk?.wx ?? 0, prevTs, ts);
    prevDisk = { rx: rx ?? 0, wx: wx ?? 0 };
    return { readBps, writeBps };
  }

  async function sampleNet(lib, ts) {
    try {
      const stats = await lib.networkStats("*");
      const { rx, tx } = sumNetBytes(Array.isArray(stats) ? stats : stats ? [stats] : []);
      const rxBps = rateFromCounters(prevNet?.rx, rx, prevTs, ts);
      const txBps = rateFromCounters(prevNet?.tx, tx, prevTs, ts);
      if (rx != null && tx != null) prevNet = { rx, tx };
      return { txBps, rxBps };
    } catch {
      return { txBps: null, rxBps: null };
    }
  }

  async function sampleGpu(lib) {
    try {
      const g = await lib.graphics();
      return pickGpu(g?.controllers || []);
    } catch {
      return null;
    }
  }

  return {
    /**
     * @returns {Promise<Snapshot>}
     */
    async sample() {
      const lib = await loadSi();
      if (!staticP) staticP = loadStatic();
      const meta = await staticP;
      const ts = Date.now();
      const [cpu, ram, disk, net, gpu] = await Promise.all([
        sampleCpu(lib).catch(() => last?.cpu ?? null),
        sampleRam(lib, meta.ramTotal).catch(() => last?.ram ?? null),
        sampleDisk(lib, ts).catch(() => last?.disk ?? { readBps: null, writeBps: null }),
        sampleNet(lib, ts).catch(() => last?.net ?? { txBps: null, rxBps: null }),
        sampleGpu(lib).catch(() => last?.gpu ?? null),
      ]);
      prevTs = ts;
      const snap = mergeLastGood(last, {
        ts,
        ...meta,
        cpu,
        ram,
        disk,
        net,
        gpu,
      });
      last = snap;
      return snap;
    },
    close() {
      winDisk?.close();
    },
  };
}
