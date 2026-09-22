const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * 1024 * 1024 * 1024;

/**
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "n/a";
  if (n >= TIB) return `${(n / TIB).toFixed(1)} TiB`;
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GiB`;
  return `${(n / MIB).toFixed(1)} MiB`;
}

/**
 * @param {number} used
 * @param {number} total
 */
export function formatBytePair(used, total) {
  const t = Number(total);
  const u = Number(used);
  if (!Number.isFinite(t) || t < 0 || !Number.isFinite(u) || u < 0) return "n/a";
  const unit = t >= TIB ? "TiB" : t >= GIB ? "GiB" : "MiB";
  const div = unit === "TiB" ? TIB : unit === "GiB" ? GIB : MIB;
  return `${(u / div).toFixed(1)} / ${(t / div).toFixed(1)} ${unit}`;
}

/**
 * Disk throughput. `null` → em dash (first tick).
 * @param {number | null | undefined} bytesPerSec
 */
export function formatByteRate(bytesPerSec) {
  if (bytesPerSec == null) return "—";
  const n = Number(bytesPerSec);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GiB/s`;
  if (n >= MIB) return `${(n / MIB).toFixed(1)} MiB/s`;
  return `${(n / KIB).toFixed(1)} KiB/s`;
}

/**
 * Network throughput in decimal bit/s, auto-scaled (kbps / Mbps / Gbps).
 * 1 kbps = 1e3 bit/s, 1 Mbps = 1e6 bit/s.
 * @param {number | null | undefined} bytesPerSec
 */
export function formatBitRate(bytesPerSec) {
  if (bytesPerSec == null) return "—";
  const n = Number(bytesPerSec);
  if (!Number.isFinite(n) || n < 0) return "—";
  const bits = n * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbps`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbps`;
  if (bits >= 1e3) return `${(bits / 1e3).toFixed(1)} kbps`;
  return `${bits.toFixed(0)} bps`;
}

/**
 * @param {number} percent
 */
export function formatPercent(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "n/a";
  const p = Math.min(100, Math.max(0, Math.round(n)));
  return `${String(p).padStart(3, " ")}%`;
}

/**
 * @param {number} seconds
 */
export function formatInterval(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return "1.0s";
  return `${n.toFixed(1)}s`;
}

/**
 * @param {number} physical
 * @param {number} logical
 */
export function formatCores(physical, logical) {
  const p = Number(physical);
  const l = Number(logical);
  const ps = Number.isFinite(p) && p > 0 ? String(Math.round(p)) : "?";
  const ls = Number.isFinite(l) && l > 0 ? String(Math.round(l)) : "?";
  return `${ps}P/${ls}L`;
}

export function formatCoresDetail(physical, logical) {
  return formatCores(physical, logical).replace("/", " / ");
}
