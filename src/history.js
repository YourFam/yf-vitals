import { HISTORY_SIZE } from "./bar.js";

/**
 * @typedef {object} History
 * @property {number[]} cpu
 * @property {number[]} ram
 * @property {number[]} gpu
 * @property {number[]} dskR
 * @property {number[]} dskW
 * @property {number[]} netUp
 * @property {number[]} netDn
 */

export function createHistory() {
  return { cpu: [], ram: [], gpu: [], dskR: [], dskW: [], netUp: [], netDn: [] };
}

/**
 * @param {number[]} buf
 * @param {number | null | undefined} value
 * @param {number} [size]
 */
export function pushSample(buf, value, size = HISTORY_SIZE) {
  if (value == null || Number.isNaN(Number(value))) return buf;
  const n = Number(value);
  if (!Number.isFinite(n)) return buf;
  const next = buf.length >= size ? buf.slice(buf.length - size + 1) : buf.slice();
  next.push(n);
  return next;
}

/**
 * @param {History} history
 * @param {import("./sample.js").Snapshot} snap
 * @returns {History}
 */
export function appendHistory(history, snap) {
  return {
    cpu: pushSample(history.cpu, snap.cpu?.percent),
    ram: pushSample(history.ram, snap.ram?.percent),
    gpu: pushSample(history.gpu, snap.gpu?.percent),
    dskR: pushSample(history.dskR, snap.disk?.readBps),
    dskW: pushSample(history.dskW, snap.disk?.writeBps),
    netUp: pushSample(history.netUp, snap.net?.txBps),
    netDn: pushSample(history.netDn, snap.net?.rxBps),
  };
}
