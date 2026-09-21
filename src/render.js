import { useAscii } from "./ascii.js";
import { BAR_WIDTH, bar, barCharset, sparkWidth, sparkline } from "./bar.js";
import { createColor, stripAnsi } from "./color.js";
import {
  formatBitRate,
  formatBytePair,
  formatByteRate,
  formatBytes,
  formatCores,
  formatCoresDetail,
  formatInterval,
  formatPercent,
} from "./format.js";

/**
 * @param {string} line
 * @param {number} columns
 */
export function fitLine(line, columns) {
  const cols = Number(columns);
  if (!Number.isFinite(cols) || cols < 8) return line;
  const plain = stripAnsi(line);
  if (plain.length <= cols) return line;
  if (plain === line) return line.slice(0, cols);
  let out = "";
  let visible = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\u001b") {
      const end = line.indexOf("m", i);
      if (end === -1) break;
      out += line.slice(i, end + 1);
      i = end;
      continue;
    }
    if (visible >= cols) break;
    out += line[i];
    visible += 1;
  }
  return out;
}

/**
 * @param {import("./sample.js").GpuSample | null | undefined} gpu
 * @param {{ history: number[], ascii: boolean, color: ReturnType<typeof createColor>, sparkW: number }} opts
 * @returns {string[] | null}
 */
export function buildGpuRow(gpu, opts) {
  if (gpu == null) return null;
  const { ascii, color, sparkW, history } = opts;
  const cs = barCharset(ascii);
  const pct = gpu.percent;
  const barStr =
    pct == null ? null : bar(pct, BAR_WIDTH, cs);
  const pctStr = pct == null ? "n/a" : formatPercent(pct);
  const mem =
    gpu.used != null && gpu.total != null ? formatBytePair(gpu.used, gpu.total) : "";
  const label = color.green("GPU");
  const head =
    barStr == null
      ? `${label}  ${pctStr}${mem ? `   ${mem}` : ""}`
      : `${label}  [${color.green(barStr)}]  ${pctStr}${mem ? `   ${mem}` : ""}`;
  const spark = color.green(sparkline(history, sparkW, { ascii, max: 100 }));
  return [head, `     ${spark}`];
}

/**
 * @param {import("./sample.js").Snapshot} snap
 * @param {import("./history.js").History} history
 * @param {{ columns?: number, env?: NodeJS.ProcessEnv, isTTY?: boolean, intervalSec?: number }} [opts]
 */
export function renderFrame(snap, history, opts = {}) {
  const columns = opts.columns ?? 80;
  const env = opts.env ?? {};
  const ascii = useAscii(env);
  const color = createColor({ isTTY: Boolean(opts.isTTY), env });
  const sparkW = sparkWidth(columns);
  const cs = barCharset(ascii);
  const interval = formatInterval(opts.intervalSec ?? 1);
  const cores = formatCores(snap.physical, snap.logical);
  const ramTot = formatBytes(snap.ramTotal);
  const header = [
    "yf-vitals",
    snap.hostname || "localhost",
    snap.osName || "unknown",
    cores,
    ramTot,
    interval,
  ].join("   ");

  /** @type {string[]} */
  const lines = [header, ""];

  if (snap.cpu) {
    const b = color.cyan(bar(snap.cpu.percent, BAR_WIDTH, cs));
    const detail = formatCoresDetail(snap.physical, snap.logical);
    lines.push(
      `${color.cyan("CPU")}  [${b}]  ${formatPercent(snap.cpu.percent)}   ${detail}`,
    );
    lines.push(`     ${color.cyan(sparkline(history.cpu, sparkW, { ascii, max: 100 }))}`);
  } else {
    lines.push(`${color.cyan("CPU")}  n/a`);
    lines.push(`     ${color.cyan(sparkline(history.cpu, sparkW, { ascii, max: 100 }))}`);
  }
  lines.push("");

  if (snap.ram) {
    const b = color.magenta(bar(snap.ram.percent, BAR_WIDTH, cs));
    lines.push(
      `${color.magenta("RAM")}  [${b}]  ${formatPercent(snap.ram.percent)}   ${formatBytePair(snap.ram.used, snap.ram.total)}`,
    );
    lines.push(`     ${color.magenta(sparkline(history.ram, sparkW, { ascii, max: 100 }))}`);
  } else {
    lines.push(`${color.magenta("RAM")}  n/a`);
    lines.push(`     ${color.magenta(sparkline(history.ram, sparkW, { ascii, max: 100 }))}`);
  }
  lines.push("");

  const gpuLines = buildGpuRow(snap.gpu, {
    history: history.gpu,
    ascii,
    color,
    sparkW,
  });
  if (gpuLines) {
    lines.push(...gpuLines);
    lines.push("");
  }

  if (snap.disk) {
    const r = formatByteRate(snap.disk.readBps);
    const w = formatByteRate(snap.disk.writeBps);
    lines.push(`${color.green("DSK")}  R  ${r.padStart(11)}   W  ${w.padStart(11)}`);
    lines.push(`     ${color.green(sparkline(history.dsk, sparkW, { ascii }))}`);
  } else {
    lines.push(`${color.green("DSK")}  n/a`);
    lines.push(`     ${color.green(sparkline(history.dsk, sparkW, { ascii }))}`);
  }
  lines.push("");

  if (snap.net) {
    const up = formatBitRate(snap.net.txBps);
    const down = formatBitRate(snap.net.rxBps);
    lines.push(`${color.yellow("NET")}  ↑  ${up.padStart(10)}    ↓  ${down.padStart(10)}`);
    lines.push(`     ${color.yellow(sparkline(history.net, sparkW, { ascii }))}`);
  } else {
    lines.push(`${color.yellow("NET")}  n/a`);
    lines.push(`     ${color.yellow(sparkline(history.net, sparkW, { ascii }))}`);
  }
  lines.push("");
  lines.push("q quit");

  return lines.map((ln) => fitLine(ln, columns)).join("\n");
}
