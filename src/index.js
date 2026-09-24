import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpText, parseArgs } from "./args.js";
import { runDashboard } from "./dashboard.js";
import { CliError } from "./errors.js";
import { restoreTerminal } from "./tty.js";

const pkg = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
);

function defaultDeps() {
  return {
    env: process.env,
    version: pkg.version,
    log: (msg) => console.log(msg),
    err: (msg) => console.error(msg),
    write: (s) => process.stdout.write(s),
    isTTY: () => Boolean(process.stdout.isTTY),
    columns: () => process.stdout.columns || 80,
    rows: () => process.stdout.rows || 24,
    stdin: process.stdin,
    process,
  };
}

/**
 * @param {string[]} argv
 * @param {Partial<ReturnType<typeof defaultDeps>> & { dashboard?: Function }} [overrides]
 * @returns {Promise<number>}
 */
export async function main(argv, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof CliError) {
      deps.err(err.message);
      return err.exitCode;
    }
    throw err;
  }

  if (args.help) {
    deps.log(helpText());
    return 0;
  }
  if (args.version) {
    deps.log(deps.version);
    return 0;
  }

  if (!deps.isTTY()) {
    deps.err("yf-vitals needs a terminal.");
    return 1;
  }

  const dash = deps.dashboard || runDashboard;
  return dash(args, deps);
}

/**
 * @param {string[]} argv
 */
export async function run(argv) {
  let entered = false;
  const wrapWrite = (s) => process.stdout.write(s);
  try {
    const code = await main(argv, {
      write: (s) => {
        entered = entered || s.includes("\u001b[?1049h");
        wrapWrite(s);
      },
    });
    process.exit(typeof code === "number" ? code : 0);
  } catch (err) {
    if (entered) {
      try {
        restoreTerminal(wrapWrite, process.stdin);
      } catch {
        // last-ditch
      }
    }
    const message = err instanceof CliError ? err.message : err?.message || String(err);
    console.error(message);
    process.exit(err instanceof CliError ? err.exitCode : 1);
  }
}
