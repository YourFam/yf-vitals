import { HISTORY_SIZE } from "./bar.js";

/**
 * @typedef {object} History
 * @property {number[]} cpu
 * @property {number[]} ram
 * @property {number[]} gpu
 * @property {number[]} dsk
 * @property {number[]} net
 */

export function createHistory() {
  return { cpu: [], ram: [], gpu: [], dsk: [], net: [] };
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
  const cpu = snap.cpu?.percent;
  const ram = snap.ram?.percent;
  const gpu = snap.gpu?.percent;
  const read = snap.disk?.readBps;
  const write = snap.disk?.writeBps;
  const tx = snap.net?.txBps;
  const rx = snap.net?.rxBps;
  let dsk;
  if (read != null || write != null) {
    dsk = (read ?? 0) + (write ?? 0);
  }
  let net;
  if (tx != null || rx != null) {
    net = (tx ?? 0) + (rx ?? 0);
  }
  return {
    cpu: pushSample(history.cpu, cpu),
    ram: pushSample(history.ram, ram),
    gpu: pushSample(history.gpu, gpu),
    dsk: pushSample(history.dsk, dsk),
    net: pushSample(history.net, net),
  };
}
