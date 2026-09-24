export const BAR_WIDTH = 20;
export const HISTORY_SIZE = 60;
export const SPARK_MIN = 16;
export const SPARK_MAX = 60;
export const SPARK_GUTTER = 36;

export const UNI_BAR_FILLED = "█";
export const UNI_BAR_EMPTY = "░";
export const ASC_BAR_FILLED = "#";
export const ASC_BAR_EMPTY = "-";

export const UNI_SPARK = "▁▂▃▄▅▆▇█";
export const ASC_SPARK = "_-=#";

/**
 * @param {number} percent
 * @param {number} width
 * @param {{ filled?: string, empty?: string }} [opts]
 */
export function bar(percent, width, opts = {}) {
  const filled = opts.filled ?? UNI_BAR_FILLED;
  const empty = opts.empty ?? UNI_BAR_EMPTY;
  const w = Math.max(0, Math.floor(width));
  const n = Number(percent);
  const p = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  const fillCount = w === 0 ? 0 : Math.round((p / 100) * w);
  return filled.repeat(fillCount) + empty.repeat(w - fillCount);
}

/**
 * @param {boolean} ascii
 */
export function barCharset(ascii) {
  return ascii
    ? { filled: ASC_BAR_FILLED, empty: ASC_BAR_EMPTY }
    : { filled: UNI_BAR_FILLED, empty: UNI_BAR_EMPTY };
}

export const BAR_WIDTH_FULL = 40;

/**
 * @param {number} columns
 * @param {{ full?: boolean }} [opts]
 */
export function sparkWidth(columns, opts = {}) {
  const cols = Number(columns);
  const available = Number.isFinite(cols) && cols > 0 ? cols - SPARK_GUTTER : SPARK_MAX;
  const cap = opts.full ? available : SPARK_MAX;
  return Math.max(SPARK_MIN, Math.min(cap, available));
}

/**
 * Vertical block chart, top row first. Scaled 0–100.
 * Bottom row keeps the low tick; rows the value never reaches stay blank.
 * Missing samples pad on the left the same way.
 *
 * @param {number[]} values
 * @param {number} width
 * @param {{ rows?: number, ascii?: boolean }} [opts]
 * @returns {string[]}
 */
export function tallChart(values, width, opts = {}) {
  const rows = Math.max(1, Math.floor(opts.rows ?? 4));
  const ascii = Boolean(opts.ascii);
  const w = Math.max(0, Math.floor(width));
  const levelsPerRow = ascii ? 1 : 8;
  const totalLevels = rows * levelsPerRow;
  const charset = ascii ? ASC_SPARK : UNI_SPARK;
  const floor = charset[0];
  const list = (Array.isArray(values) ? values : []).slice(-w);
  /** @type {Array<number | null>} */
  const cols = Array(w - list.length).fill(null).concat(list);
  /** @type {string[]} */
  const lines = [];
  for (let row = rows - 1; row >= 0; row -= 1) {
    let line = "";
    for (const value of cols) {
      const n = value == null ? 0 : Number(value);
      const h =
        value == null || !Number.isFinite(n) || n <= 0
          ? 0
          : Math.round(Math.min(1, n / 100) * totalLevels);
      const local = h - row * levelsPerRow;
      if (ascii) {
        if (local >= 1) line += ASC_BAR_FILLED;
        else line += row === 0 ? floor : " ";
      } else if (local >= 8) line += UNI_BAR_FILLED;
      else if (local > 0) line += charset[local - 1];
      else line += row === 0 ? floor : " ";
    }
    lines.push(line);
  }
  return lines;
}

/**
 * @param {number[]} values
 * @param {number} width
 * @param {{ ascii?: boolean, max?: number }} [opts]
 */
export function sparkline(values, width, opts = {}) {
  const w = Math.max(0, Math.floor(width));
  if (w === 0) return "";
  const charset = opts.ascii ? ASC_SPARK : UNI_SPARK;
  const list = Array.isArray(values) ? values : [];
  const floor = charset[0];
  if (list.length === 0) {
    return floor.repeat(w);
  }
  const slice = list.slice(-w);
  const pad = w - slice.length;
  const explicitMax = opts.max;
  const dataMax = slice.reduce((m, v) => (v > m ? v : m), 0);
  const max = explicitMax != null ? explicitMax : dataMax;
  const chars = slice.map((v) => sparkChar(v, max, charset));
  return floor.repeat(pad) + chars.join("");
}

export const HEAT_WARM = 50;
export const HEAT_HOT = 80;

/**
 * @param {number} percent
 * @returns {"ok" | "warm" | "hot"}
 */
export function heatLevel(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < HEAT_WARM) return "ok";
  if (n < HEAT_HOT) return "warm";
  return "hot";
}

/**
 * @param {number} value
 * @param {number} max
 * @param {string} charset
 */
function sparkChar(value, max, charset) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(max) || max <= 0) {
    return charset[0];
  }
  const ratio = Math.min(1, n / max);
  const idx = Math.round(ratio * (charset.length - 1));
  return charset[idx];
}
