/**
 * Bytes/s (or any counter/s) from two cumulative counters.
 * First sample returns null. Counter wrap or non-positive elapsed → null.
 *
 * @param {number | null | undefined} prev
 * @param {number | null | undefined} current
 * @param {number | null | undefined} prevTs
 * @param {number | null | undefined} currentTs
 * @returns {number | null}
 */
export function rateFromCounters(prev, current, prevTs, currentTs) {
  if (prev == null || current == null || prevTs == null || currentTs == null) {
    return null;
  }
  const dtMs = Number(currentTs) - Number(prevTs);
  if (!Number.isFinite(dtMs) || dtMs <= 0) return null;
  const a = Number(prev);
  const b = Number(current);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / (dtMs / 1000);
}
