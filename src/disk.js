import { spawn } from "node:child_process";

const PS_COUNTERS = `
$ErrorActionPreference = 'SilentlyContinue'
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line -eq 'q') { break }
  $dr = [int64]0
  $dw = [int64]0
  $rx = [int64]0
  $tx = [int64]0
  $d = Get-CimInstance -ClassName Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  if ($d) {
    $dr = [int64]$d.DiskReadBytesPersec
    $dw = [int64]$d.DiskWriteBytesPersec
  }
  Get-NetAdapterStatistics | ForEach-Object {
    $name = [string]$_.Name
    if ($name -match 'vEthernet|Loopback|Bluetooth|WSL|Hyper-V|Virtual|Pseudo|isatap|Teredo') { return }
    $rx += [int64]$_.ReceivedBytes
    $tx += [int64]$_.SentBytes
  }
  Write-Output ("{0} {1} {2} {3}" -f $dr, $dw, $rx, $tx)
}
`.trim();

/**
 * @param {string} line
 * @returns {{ rx: number, wx: number, netRx: number, netTx: number } | null}
 */
export function parseDiskCounterLine(line) {
  const m = String(line || "")
    .trim()
    .match(/^(\d+)\s+(\d+)(?:\s+(\d+)\s+(\d+))?$/);
  if (!m) return null;
  return {
    rx: Number(m[1]),
    wx: Number(m[2]),
    netRx: m[3] != null ? Number(m[3]) : 0,
    netTx: m[4] != null ? Number(m[4]) : 0,
  };
}

function encodedCommand(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Long-lived PowerShell so WMI stays warm (~10ms/tick after first query).
 * One round-trip: disk bytes + physical NIC byte counters.
 */
export function createWindowsDiskReader() {
  let child = null;
  let buf = "";
  /** @type {{ resolve: (v: ReturnType<typeof parseDiskCounterLine>) => void }[]} */
  let pending = [];
  let closed = false;

  function flushLine(line) {
    const job = pending.shift();
    if (job) job.resolve(parseDiskCounterLine(line));
  }

  function ensure() {
    if (child || closed) return;
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand(PS_COUNTERS)],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        flushLine(line);
      }
    });
    child.on("exit", () => {
      child = null;
      buf = "";
      while (pending.length) {
        pending.shift()?.resolve(null);
      }
    });
  }

  return {
    /**
     * @returns {Promise<ReturnType<typeof parseDiskCounterLine>>}
     */
    read() {
      if (closed) return Promise.resolve(null);
      ensure();
      if (!child || !child.stdin.writable) return Promise.resolve(null);
      return new Promise((resolve) => {
        const t = setTimeout(() => {
          const i = pending.findIndex((p) => p.resolve === done);
          if (i >= 0) pending.splice(i, 1);
          resolve(null);
        }, 2500);
        const done = (v) => {
          clearTimeout(t);
          resolve(v);
        };
        pending.push({ resolve: done });
        try {
          child.stdin.write("g\n");
        } catch {
          clearTimeout(t);
          resolve(null);
        }
      });
    },
    close() {
      closed = true;
      try {
        child?.stdin.write("q\n");
      } catch {
        // ignore
      }
      try {
        child?.kill();
      } catch {
        // ignore
      }
      child = null;
    },
  };
}
