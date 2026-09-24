import { useAscii } from "./ascii.js";
import {
  BAR_WIDTH,
  BAR_WIDTH_FULL,
  bar,
  barCharset,
  heatLevel,
  sparkWidth,
  sparkline,
  tallChart,
} from "./bar.js";
import { createColor, stripAnsi } from "./color.js";
import {
  formatBitRate,
  formatBytePair,
  formatByteRate,
  formatBytes,
  formatClock,
  formatCores,
  formatCoresDetail,
  formatInterval,
  formatPercent,
} from "./format.js";
import { PROC_LIMIT } from "./processes.js";

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
export function paintPercentBar(percent, color, row, ascii, width = BAR_WIDTH) {
  const cs = barCharset(ascii);
  const raw = bar(percent, width, cs);
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
 * How tall the percent charts are, and how many process rows fit.
 * Chart height drops 4 → 2 → 1 before process rows drop.
 *
 * @param {{ full?: boolean, rows?: number, columns?: number, gpu?: boolean, partitions?: number, swap?: boolean, cores?: boolean, processes?: import("./sample.js").ProcessBlock | null }} opts
 */
export function chooseLayout(opts) {
  const full = Boolean(opts.full);
  const term = Number(opts.rows) > 0 ? Number(opts.rows) : full ? 48 : 24;
  const columns = Number(opts.columns) > 0 ? Number(opts.columns) : 80;
  const gpu = Boolean(opts.gpu);
  const partitions = Math.max(0, Number(opts.partitions) || 0);
  const swap = Boolean(opts.swap);
  const processes = opts.processes;
  const gpuCol = Array.isArray(processes?.gpu);
  const sections = processes ? (gpuCol ? 3 : 2) : 0;
  const sideBySide = columns >= 76;
  const dataN = processes
    ? Math.min(
        PROC_LIMIT,
        Math.max(
          processes.cpu?.length || 0,
          processes.ram?.length || 0,
          gpuCol ? processes.gpu.length : 0,
        ),
      )
    : 0;
  const series = 2 + (gpu ? 1 : 0);
  const fixed =
    2 +
    1 +
    (opts.cores ? 1 : 0) +
    1 +
    1 +
    (swap ? 1 : 0) +
    1 +
    (gpu ? 2 : 0) +
    3 +
    3 +
    partitions * 2 +
    1;

  const procLines = (n) => {
    if (!processes || n <= 0) return 0;
    const body = sideBySide ? 1 + n : sections * (1 + n);
    return body + 1;
  };

  let chartH = full ? 4 : 1;
  let procN = dataN;
  const fits = (h, n) => fixed + series * h + procLines(n) <= term;
  while (!fits(chartH, procN) && chartH > 1) chartH = chartH === 4 ? 2 : 1;
  while (!fits(chartH, procN) && procN > 0) procN -= 1;

  return {
    chartH,
    procN,
    barWidth: full ? BAR_WIDTH_FULL : BAR_WIDTH,
    sideBySide,
  };
}

/**
 * @param {number[]} values
 * @param {ReturnType<typeof createColor>} color
 * @param {"cyan" | "magenta" | "green"} row
 * @param {{ chartH: number, sparkW: number, ascii: boolean }} opts
 */
function chartLines(values, color, row, opts) {
  const paint = color[row];
  if (opts.chartH <= 1) {
    return [`     ${paint(sparkline(values, opts.sparkW, { ascii: opts.ascii, max: 100 }))}`];
  }
  return tallChart(values, opts.sparkW, { rows: opts.chartH, ascii: opts.ascii }).map(
    (line) => `     ${paint(line)}`,
  );
}

/**
 * @param {number[] | null | undefined} cores
 * @param {ReturnType<typeof createColor>} color
 * @param {boolean} ascii
 */
function coresLine(cores, color, ascii) {
  if (!Array.isArray(cores) || cores.length === 0) return null;
  const ticks = cores
    .map((pct) => heatPaint(color, pct, "cyan")(sparkline([pct], 1, { ascii, max: 100 })))
    .join("");
  return `     ${color.cyan("cores ")}${ticks}`;
}

/**
 * @param {import("./sample.js").GpuSample | null | undefined} gpu
 * @param {{ history: number[], ascii: boolean, color: ReturnType<typeof createColor>, sparkW: number, barWidth?: number, chartH?: number, extras?: boolean }} opts
 * @returns {string[] | null}
 */
export function buildGpuRow(gpu, opts) {
  if (gpu == null) return null;
  const { ascii, color, sparkW, history } = opts;
  const barWidth = opts.barWidth ?? BAR_WIDTH;
  const chartH = opts.chartH ?? 1;
  const pct = gpu.percent;
  const pctStr = pct == null ? "n/a" : formatPercent(pct);
  const mem =
    gpu.used != null && gpu.total != null ? formatBytePair(gpu.used, gpu.total) : "";
  const extras = [];
  if (opts.extras && gpu.tempC != null) extras.push(`${Math.round(gpu.tempC)}°C`);
  if (opts.extras && gpu.powerW != null) extras.push(`${Math.round(gpu.powerW)} W`);
  const tail = [mem, ...extras].filter(Boolean).join("   ");
  const label = color.green("GPU");
  const head =
    pct == null
      ? `${label}  ${pctStr}${tail ? `   ${tail}` : ""}`
      : `${label}  ${paintPercentBar(pct, color, "green", ascii, barWidth)}  ${pctStr}${tail ? `   ${tail}` : ""}`;
  return [head, ...chartLines(history, color, "green", { chartH, sparkW, ascii })];
}

const CPU_NAME = 13;
const RAM_NAME = 12;
const GPU_NAME = 13;
const RAM_AMT = 10;

/**
 * @param {string} name
 * @param {number} width
 */
function clipName(name, width) {
  const s = String(name || "");
  return s.length > width ? s.slice(0, width) : s.padEnd(width);
}

/**
 * @param {ReturnType<typeof createColor>} color
 * @param {number} percent
 * @param {"cyan" | "magenta" | "green"} row
 */
function heatPercent(color, percent, row) {
  return heatPaint(color, percent, row)(formatPercent(percent));
}

/**
 * @param {import("./sample.js").ProcessBlock} block
 * @param {ReturnType<typeof createColor>} color
 * @param {{ procN: number, sideBySide: boolean }} layout
 */
function processLines(block, color, layout) {
  const n = layout.procN;
  const cpu = (block.cpu || []).slice(0, n);
  const ram = (block.ram || []).slice(0, n);
  const gpu = Array.isArray(block.gpu) ? block.gpu.slice(0, n) : null;
  const rows = Math.max(cpu.length, ram.length, gpu ? gpu.length : 0, n);
  if (layout.sideBySide) {
    /** @type {string[]} */
    const lines = [
      color.cyan("CPU".padEnd(CPU_NAME + 4 + 3)) +
        color.magenta("RAM".padEnd(RAM_NAME + RAM_AMT + 2)) +
        (gpu ? color.green("GPU") : ""),
    ];
    for (let i = 0; i < rows; i += 1) {
      const c = cpu[i];
      const r = ram[i];
      const g = gpu ? gpu[i] : null;
      const cpuCol = c
        ? `${clipName(c.name, CPU_NAME)}${heatPercent(color, c.percent ?? 0, "cyan")}   `
        : " ".repeat(CPU_NAME + 4 + 3);
      const ramCol = r
        ? `${clipName(r.name, RAM_NAME)}${color.magenta(formatBytes(r.mem ?? 0).padEnd(RAM_AMT))}  `
        : " ".repeat(RAM_NAME + RAM_AMT + 2);
      const gpuCol = g ? `${clipName(g.name, GPU_NAME)}${heatPercent(color, g.percent ?? 0, "green")}` : "";
      lines.push(cpuCol + ramCol + gpuCol);
    }
    return lines;
  }
  /** @type {string[]} */
  const stacked = [color.cyan("CPU")];
  for (const row of cpu) stacked.push(`${clipName(row.name, CPU_NAME)}  ${heatPercent(color, row.percent ?? 0, "cyan")}`);
  stacked.push(color.magenta("RAM"));
  for (const row of ram) stacked.push(`${clipName(row.name, RAM_NAME)}  ${color.magenta(formatBytes(row.mem ?? 0))}`);
  if (gpu) {
    stacked.push(color.green("GPU"));
    for (const row of gpu) stacked.push(`${clipName(row.name, GPU_NAME)}  ${heatPercent(color, row.percent ?? 0, "green")}`);
  }
  return stacked;
}

/**
 * @param {import("./sample.js").Snapshot} snap
 * @param {import("./history.js").History} history
 * @param {{ columns?: number, rows?: number, env?: NodeJS.ProcessEnv, isTTY?: boolean, intervalSec?: number, full?: boolean, process?: boolean }} [opts]
 */
export function renderFrame(snap, history, opts = {}) {
  const columns = opts.columns ?? 80;
  const env = opts.env ?? {};
  const full = Boolean(opts.full);
  const ascii = useAscii(env);
  const color = createColor({ isTTY: Boolean(opts.isTTY), env });
  const sparkW = sparkWidth(columns, { full });
  const processes = opts.process && snap.processes ? snap.processes : null;
  const swapOn = full && snap.swap != null && snap.swap.used > 0;
  const layout = chooseLayout({
    full,
    rows: opts.rows,
    columns,
    gpu: snap.gpu != null,
    partitions: Array.isArray(snap.diskUse) ? snap.diskUse.length : 0,
    swap: swapOn,
    cores: full && Array.isArray(snap.cpu?.cores) && snap.cpu.cores.length > 0,
    processes,
  });
  const { barWidth, chartH } = layout;
  const chartOpts = { chartH, sparkW, ascii };
  const interval = formatInterval(opts.intervalSec ?? 1);
  const cores = formatCores(snap.physical, snap.logical);
  const ramTot = formatBytes(snap.ramTotal);
  const headerParts = [
    "yf-vitals",
    snap.hostname || "localhost",
    snap.osName || "unknown",
    cores,
    ramTot,
    interval,
  ];
  if (full) headerParts.push(formatClock(snap.ts));
  const header = headerParts.join("   ");

  /** @type {string[]} */
  const lines = [header, ""];

  if (snap.cpu) {
    const detail = formatCoresDetail(snap.physical, snap.logical);
    lines.push(
      `${color.cyan("CPU")}  ${paintPercentBar(snap.cpu.percent, color, "cyan", ascii, barWidth)}  ${formatPercent(snap.cpu.percent)}   ${detail}`,
    );
  } else {
    lines.push(`${color.cyan("CPU")}  n/a`);
  }
  lines.push(...chartLines(history.cpu, color, "cyan", chartOpts));
  if (full) {
    const ticks = coresLine(snap.cpu?.cores, color, ascii);
    if (ticks) lines.push(ticks);
  }
  lines.push("");

  if (snap.ram) {
    lines.push(
      `${color.magenta("RAM")}  ${paintPercentBar(snap.ram.percent, color, "magenta", ascii, barWidth)}  ${formatPercent(snap.ram.percent)}   ${formatBytePair(snap.ram.used, snap.ram.total)}`,
    );
  } else {
    lines.push(`${color.magenta("RAM")}  n/a`);
  }
  lines.push(...chartLines(history.ram, color, "magenta", chartOpts));
  if (swapOn && snap.swap) {
    lines.push(
      `${color.magenta("SWP")}  ${paintPercentBar(snap.swap.percent, color, "magenta", ascii, barWidth)}  ${formatPercent(snap.swap.percent)}   ${formatBytePair(snap.swap.used, snap.swap.total)}`,
    );
  }
  lines.push("");

  const gpuLines = buildGpuRow(snap.gpu, {
    history: history.gpu,
    ascii,
    color,
    sparkW,
    barWidth,
    chartH,
    extras: full,
  });
  if (gpuLines) {
    lines.push(...gpuLines);
    lines.push("");
  }

  if (snap.disk) {
    const r = formatByteRate(snap.disk.readBps);
    const w = formatByteRate(snap.disk.writeBps);
    lines.push(`${color.green("DSK")}  R  ${r.padStart(11)}   W  ${w.padStart(11)}`);
  } else {
    lines.push(`${color.green("DSK")}  n/a`);
  }
  lines.push(
    `     ${color.green(splitSparkLine("R", history.dskR, "W", history.dskW, sparkW, ascii))}`,
  );
  lines.push("");

  if (snap.net) {
    const up = formatBitRate(snap.net.txBps);
    const down = formatBitRate(snap.net.rxBps);
    lines.push(`${color.yellow("NET")}  ↑  ${up.padStart(12)}    ↓  ${down.padStart(12)}`);
  } else {
    lines.push(`${color.yellow("NET")}  n/a`);
  }
  lines.push(
    `     ${color.yellow(splitSparkLine("↑", history.netUp, "↓", history.netDn, sparkW, ascii))}`,
  );
  lines.push("");

  if (Array.isArray(snap.diskUse) && snap.diskUse.length) {
    for (const vol of snap.diskUse) {
      const label = vol.mount.length >= 3 ? vol.mount.slice(0, 4) : vol.mount.padEnd(3);
      lines.push(
        `${color.green(label)}  ${paintPercentBar(vol.percent, color, "green", ascii, barWidth)}  ${formatPercent(vol.percent)}   ${formatBytePair(vol.used, vol.total)}`,
      );
      lines.push("");
    }
  }

  if (processes && layout.procN > 0) {
    lines.push(...processLines(processes, color, layout));
    lines.push("");
  }

  lines.push("q quit");

  return lines.map((ln) => fitLine(ln, columns)).join("\n");
}
