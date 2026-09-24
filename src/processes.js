import { execFile } from "node:child_process";

export const PROC_LIMIT = 8;

const SKIP = new Set(["system idle process", "idle"]);

/**
 * @param {string} name
 */
export function processBasename(name) {
  const base = String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  if (!base) return "";
  return base.replace(/\.exe$/i, "");
}

/**
 * @param {string} text nvidia-smi pmon output
 * @returns {{ pid: number, sm: number, command: string }[] | null}
 */
export function parseNvidiaPmon(text) {
  if (text == null) return null;
  /** @type {{ pid: number, sm: number, command: string }[]} */
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trim = line.trim();
    if (!trim || trim.startsWith("#")) continue;
    const parts = trim.split(/\s+/);
    if (parts.length < 4) continue;
    const pid = Number(parts[1]);
    const type = parts[2];
    const sm = Number(parts[3]);
    if (!Number.isFinite(pid) || (type !== "C" && type !== "G") || !Number.isFinite(sm)) continue;
    const command = parts[parts.length - 1];
    rows.push({ pid, sm: Math.min(100, Math.max(0, sm)), command });
  }
  return rows;
}

/**
 * @param {Array<{ name?: string, pid?: number, cpu?: number, memRss?: number }>} list
 */
export function rankHostProcesses(list) {
  /** @type {Map<string, { name: string, percent: number, mem: number }>} */
  const byName = new Map();
  /** @type {Map<number, string>} */
  const nameByPid = new Map();
  for (const row of list || []) {
    const name = processBasename(row?.name || "");
    if (!name || SKIP.has(name.toLowerCase())) continue;
    const cpu = Number(row.cpu);
    const mem = (Number(row.memRss) || 0) * 1024;
    const key = name.toLowerCase();
    const cur = byName.get(key) || { name, percent: 0, mem: 0 };
    if (Number.isFinite(cpu) && cpu > 0) cur.percent += cpu;
    if (mem > 0) cur.mem += mem;
    byName.set(key, cur);
    const pid = Number(row.pid);
    if (Number.isFinite(pid)) nameByPid.set(pid, name);
  }
  const all = [...byName.values()];
  const cpu = [...all]
    .filter((row) => row.percent > 0)
    .sort((a, b) => b.percent - a.percent || b.mem - a.mem)
    .slice(0, PROC_LIMIT)
    .map((row) => ({ name: row.name, percent: Math.min(100, row.percent) }));
  const ram = [...all]
    .filter((row) => row.mem > 0)
    .sort((a, b) => b.mem - a.mem || b.percent - a.percent)
    .slice(0, PROC_LIMIT)
    .map((row) => ({ name: row.name, mem: row.mem }));
  return { cpu, ram, nameByPid };
}

/**
 * @param {{ pid: number, sm: number, command: string }[]} rows
 * @param {Map<number, string>} nameByPid
 */
export function rankGpuProcesses(rows, nameByPid) {
  /** @type {Map<string, { name: string, percent: number }>} */
  const byName = new Map();
  for (const row of rows || []) {
    const fromCmd = row.command && row.command !== "-" ? row.command : "";
    const name = processBasename(fromCmd) || nameByPid.get(row.pid) || "";
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = byName.get(key) || { name, percent: 0 };
    cur.percent = Math.min(100, cur.percent + (Number(row.sm) || 0));
    byName.set(key, cur);
  }
  return [...byName.values()]
    .filter((row) => row.percent > 0)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, PROC_LIMIT);
}

/**
 * @param {{ processes?: Function }} lib
 * @param {() => Promise<{ pid: number, sm: number, command: string }[] | null>} [runPmon]
 */
export async function readProcessBlock(lib, runPmon = defaultPmon) {
  const [proc, gpuRows] = await Promise.all([
    Promise.resolve()
      .then(() => lib.processes())
      .catch(() => null),
    Promise.resolve()
      .then(() => runPmon())
      .catch(() => null),
  ]);
  const list = proc?.list;
  if (!Array.isArray(list)) return null;
  const ranked = rankHostProcesses(list);
  return {
    cpu: ranked.cpu,
    ram: ranked.ram,
    gpu: gpuRows == null ? null : rankGpuProcesses(gpuRows, ranked.nameByPid),
  };
}

function defaultPmon() {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["pmon", "-c", "1"],
      { timeout: 2500, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(parseNvidiaPmon(stdout));
      },
    );
  });
}
