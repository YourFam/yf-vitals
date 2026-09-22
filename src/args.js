import { CliError } from "./errors.js";

const MIN_INTERVAL = 0.25;
const MAX_INTERVAL = 10;
const DEFAULT_INTERVAL = 1;
const LOW_POWER_INTERVAL = 2;

/**
 * @typedef {object} ParsedArgs
 * @property {boolean} help
 * @property {boolean} version
 * @property {number} interval
 * @property {boolean} lowPower
 */

/**
 * @param {string} flag
 * @param {string | undefined} value
 */
function parseIntervalValue(flag, value) {
  if (value == null || value === "" || value.startsWith("-")) {
    throw new CliError(
      `Flag ${flag} requires a number from ${MIN_INTERVAL} to ${MAX_INTERVAL}.\nSee yf-vitals --help`,
    );
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_INTERVAL || n > MAX_INTERVAL) {
    throw new CliError(
      `Flag ${flag} requires a number from ${MIN_INTERVAL} to ${MAX_INTERVAL}.\nSee yf-vitals --help`,
    );
  }
  return n;
}

/**
 * @param {string[]} argv process.argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  let help = false;
  let version = false;
  let interval = DEFAULT_INTERVAL;
  let intervalSet = false;
  let lowPower = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--version" || a === "-V") {
      version = true;
    } else if (a === "--low-power") {
      lowPower = true;
    } else if (a === "--interval") {
      interval = parseIntervalValue("--interval", args[i + 1]);
      intervalSet = true;
      i += 1;
    } else if (a.startsWith("--interval=")) {
      interval = parseIntervalValue("--interval", a.slice("--interval=".length));
      intervalSet = true;
    } else if (a.startsWith("-")) {
      throw new CliError(`Unknown flag: ${a}\nSee yf-vitals --help`);
    } else {
      throw new CliError(`Unknown argument: ${a}\nSee yf-vitals --help`);
    }
  }

  if (help || version) {
    return {
      help,
      version,
      interval: DEFAULT_INTERVAL,
      lowPower: false,
    };
  }

  if (lowPower) {
    interval = LOW_POWER_INTERVAL;
  } else if (!intervalSet) {
    interval = DEFAULT_INTERVAL;
  }

  return { help: false, version: false, interval, lowPower };
}

export function helpText() {
  return `yf-vitals — live CPU, RAM, disk, net (and GPU) bars in the terminal

Usage:
  yf-vitals
  yf-vitals --low-power
  yf-vitals --interval 0.5

  --interval <seconds>   Tick period (${MIN_INTERVAL}–${MAX_INTERVAL}, default ${DEFAULT_INTERVAL})
  --low-power            Tick every ${LOW_POWER_INTERVAL}s (wins over --interval)
  --help, -h             This text
  --version, -V          Package version

q / Q / Ctrl+C quit. GPU row is omitted when the OS has no GPU telemetry.
USE is local NTFS/APFS/HFS fill (no Google Drive, iCloud, or network shares).
Disk rates are KiB/s–GiB/s; network rates are kbps/Mbps/Gbps.
Disk / net sparks are split (R/W, ↑/↓) and scale to the pair max in the last 60 ticks.
Bar fill turns yellow ≥50% and red ≥80%. Unused spark slots use the lowest tick.
Needs a terminal (no pipes). Node 20+.`;
}
