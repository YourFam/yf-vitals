import { useAscii } from "./ascii.js";
import {
  BAR_WIDTH,
  bar,
  barCharset,
  heatLevel,
  sparkWidth,
  sparkline,
} from "./bar.js";
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
 * @param {ReturnType<typeof createColor>} color
 * @param {number} percent
 * @param {"cyan" | "magenta" | "green"} row
 */
export function heatPaint(color, percent, row) {
  const level = heatLevel(percent);
  if (level === "hot") return color.red;
  if (level === "warm") return color.yellow;
  return color[row];
}

/**
 * Percent bar: fill takes heat color, empty stays dim. Sparkline stays the row color.
 *
 * @param {number} percent
 * @param {ReturnType<typeof createColor>} color
 * @param {"cyan" | "magenta" | "green"} row
 * @param {boolean} ascii
 */
export function paintPercentBar(percent, color, row, ascii) {
  const cs = barCharset(ascii);
  const raw = bar(percent, BAR_WIDTH, cs);
  const filled = raw.replaceAll(cs.empty, "").length;
  const fill = raw.slice(0, filled);
  const empty = raw.slice(filled);
  const paint = heatPaint(color, percent, row);
  return `[${paint(fill)}${color.dim(empty)}]`;
}

/**
 * Two labeled sparks on one line, sharing a max so the pair is comparable.
 *
 * @param {string} leftLabel
 * @param {number[]} leftVals
 * @param {string} rightLabel
 * @param {number[]} rightVals
 * @param {number} sparkW
 * @param {boolean} ascii
 */
export function splitSparkLine(leftLabel, leftVals, rightLabel, rightVals, sparkW, ascii) {
  const leftTag = `${leftLabel} `;
  const mid = `  ${rightLabel} `;
  const overhead = leftTag.length + mid.length;
  const inner = Math.max(overhead + 8, Number(sparkW) || 16);
  const each = Math.max(4, Math.floor((inner - overhead) / 2));
  const pairMax = Math.max(0, ...leftVals, ...rightVals);
  const left = sparkline(leftVals, each, { ascii, max: pairMax || undefined });
  const right = sparkline(rightVals, each, { ascii, max: pairMax || undefined });
  return `${leftTag}${left}${mid}${right}`;
}

/**
 * @param {import("./sample.js").GpuSample | null | undefined} gpu
 * @param {{ history: number[], ascii: boolean, color: ReturnType<typeof createColor>, sparkW: number }} opts
 * @returns {string[] | null}
 */
export function buildGpuRow(gpu, opts) {
  if (gpu == null) return null;
  const { ascii, color, sparkW, history } = opts;
  const pct = gpu.percent;
  const pctStr = pct == null ? "n/a" : formatPercent(pct);
  const mem =
    gpu.used != null && gpu.total != null ? formatBytePair(gpu.used, gpu.total) : "";
  const label = color.green("GPU");
  const head =
    pct == null
      ? `${label}  ${pctStr}${mem ? `   ${mem}` : ""}`
      : `${label}  ${paintPercentBar(pct, color, "green", ascii)}  ${pctStr}${mem ? `   ${mem}` : ""}`;
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
    const detail = formatCoresDetail(snap.physical, snap.logical);
    lines.push(
      `${color.cyan("CPU")}  ${paintPercentBar(snap.cpu.percent, color, "cyan", ascii)}  ${formatPercent(snap.cpu.percent)}   ${detail}`,
    );
    lines.push(`     ${color.cyan(sparkline(history.cpu, sparkW, { ascii, max: 100 }))}`);
  } else {
    lines.push(`${color.cyan("CPU")}  n/a`);
    lines.push(`     ${color.cyan(sparkline(history.cpu, sparkW, { ascii, max: 100 }))}`);
  }
  lines.push("");

  if (snap.ram) {
    lines.push(
      `${color.magenta("RAM")}  ${paintPercentBar(snap.ram.percent, color, "magenta", ascii)}  ${formatPercent(snap.ram.percent)}   ${formatBytePair(snap.ram.used, snap.ram.total)}`,
    );
    lines.push(`     ${color.magenta(sparkline(history.ram, sparkW, { ascii, max: 100 }))}`);
  } else {
    lines.push(`${color.magenta("RAM")}  n/a`);
    lines.push(`     ${color.magenta(sparkline(history.ram, sparkW, { ascii, max: 100 }))}`);
  }
  lines.push("");

  if (snap.diskUse) {
    lines.push(
      `${color.green("USE")}  ${paintPercentBar(snap.diskUse.percent, color, "green", ascii)}  ${formatPercent(snap.diskUse.percent)}   ${formatBytePair(snap.diskUse.used, snap.diskUse.total)}  ${snap.diskUse.mount}`,
    );
    lines.push(`     ${color.green(sparkline(history.diskUse, sparkW, { ascii, max: 100 }))}`);
    for (const extra of snap.diskUse.others || []) {
      lines.push(
        `     ${extra.mount}  ${formatPercent(extra.percent).trim()}   ${formatBytePair(extra.used, extra.total)}`,
      );
    }
  }
  if (snap.diskUse) lines.push("");

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
    lines.push(
      `     ${color.green(splitSparkLine("R", history.dskR, "W", history.dskW, sparkW, ascii))}`,
    );
  } else {
    lines.push(`${color.green("DSK")}  n/a`);
    lines.push(
      `     ${color.green(splitSparkLine("R", history.dskR, "W", history.dskW, sparkW, ascii))}`,
    );
  }
  lines.push("");

  if (snap.net) {
    const up = formatBitRate(snap.net.txBps);
    const down = formatBitRate(snap.net.rxBps);
    lines.push(`${color.yellow("NET")}  ↑  ${up.padStart(12)}    ↓  ${down.padStart(12)}`);
    lines.push(
      `     ${color.yellow(splitSparkLine("↑", history.netUp, "↓", history.netDn, sparkW, ascii))}`,
    );
  } else {
    lines.push(`${color.yellow("NET")}  n/a`);
    lines.push(
      `     ${color.yellow(splitSparkLine("↑", history.netUp, "↓", history.netDn, sparkW, ascii))}`,
    );
  }
  lines.push("");
  lines.push("q quit");

  return lines.map((ln) => fitLine(ln, columns)).join("\n");
}
