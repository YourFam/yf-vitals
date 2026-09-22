const MIN_BYTES = 8 * 1024 * 1024 * 1024;

const SKIP_FS =
  /^(fat|fat12|fat16|fat32|msdos|nfs|smbfs|cifs|afp|webdav|fuse|sshfs|osxfuse|macfuse|tmpfs|devfs|autofs|iso9660|udf|overlay|9p)$/i;

const SKIP_NAME =
  /google\s*drive|gdrive|icloud|onedrive|dropbox|cloudstorage|cloudmounter|box\.com/i;

const SKIP_MOUNT =
  /^\/(System\/Volumes\/(Preboot|VM|Update|Recovery|iOS|hardware|xarts|cryptex)|\.MobileBackups|Volumes\/\.timemachine)/i;

const LOCAL_FS = /^(ntfs|refs|apfs|hfs|hfs\+|ext[234]|xfs|btrfs|zfs)$/i;

/**
 * @param {{ fs?: string, type?: string, mount?: string, size?: number, used?: number }} row
 */
export function isLocalCapacityVolume(row) {
  if (!row) return false;
  const type = String(row.type || "");
  const mount = String(row.mount || "");
  const fs = String(row.fs || "");
  const blob = `${type} ${mount} ${fs}`;
  if (SKIP_NAME.test(blob)) return false;
  if (SKIP_FS.test(type)) return false;
  if (SKIP_MOUNT.test(mount)) return false;
  const size = Number(row.size) || 0;
  if (size < MIN_BYTES) return false;
  if (LOCAL_FS.test(type)) return true;
  if (/^[A-Z]:\\?$/i.test(mount || fs) && LOCAL_FS.test(type)) return true;
  if (mount === "/" || mount === "/System/Volumes/Data") return true;
  return false;
}

/**
 * @param {string} mount
 */
export function shortMount(mount) {
  const m = String(mount || "");
  const drive = m.match(/^([A-Z]:)\\?$/i);
  if (drive) return drive[1].toUpperCase();
  if (m === "/System/Volumes/Data") return "Data";
  if (m === "/") return "/";
  const parts = m.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || m || "?";
}

/**
 * @param {{ fs?: string, type?: string, mount?: string, size?: number, used?: number, use?: number }} row
 */
function systemScore(row) {
  const m = String(row.mount || "");
  if (/^C:\\?$/i.test(m)) return 3;
  if (m === "/System/Volumes/Data") return 2;
  if (m === "/") return 1;
  return 0;
}

/**
 * @param {Array<{ fs?: string, type?: string, mount?: string, size?: number, used?: number, use?: number }>} rows
 * @returns {{ percent: number, used: number, total: number, mount: string, others: { percent: number, used: number, total: number, mount: string }[] } | null}
 */
export function summarizeLocalDisks(rows) {
  const local = (Array.isArray(rows) ? rows : []).filter(isLocalCapacityVolume);
  /** @type {typeof local} */
  const uniq = [];
  for (const r of local.slice().sort((a, b) => systemScore(b) - systemScore(a) || (b.size || 0) - (a.size || 0))) {
    const dupIdx = uniq.findIndex(
      (u) =>
        Math.abs((u.size || 0) - (r.size || 0)) < 1024 * 1024 &&
        Math.abs((u.used || 0) - (r.used || 0)) < 0.01 * (r.size || 1),
    );
    if (dupIdx >= 0) continue;
    uniq.push(r);
  }
  if (!uniq.length) return null;
  const primary = uniq[0];
  const total = Number(primary.size) || 0;
  const used = Number(primary.used) || 0;
  const percent =
    typeof primary.use === "number" && Number.isFinite(primary.use)
      ? primary.use
      : total > 0
        ? (used / total) * 100
        : 0;
  return {
    percent: Math.min(100, Math.max(0, percent)),
    used,
    total,
    mount: shortMount(primary.mount || primary.fs || ""),
    others: uniq.slice(1).map((r) => {
      const t = Number(r.size) || 0;
      const u = Number(r.used) || 0;
      const p =
        typeof r.use === "number" && Number.isFinite(r.use) ? r.use : t > 0 ? (u / t) * 100 : 0;
      return {
        percent: Math.min(100, Math.max(0, p)),
        used: u,
        total: t,
        mount: shortMount(r.mount || r.fs || ""),
      };
    }),
  };
}
