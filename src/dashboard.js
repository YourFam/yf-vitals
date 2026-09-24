import { appendHistory, createHistory } from "./history.js";
import { renderFrame } from "./render.js";
import { createSampler, instantSnapshot, mergeLastGood } from "./sample.js";
import { CLEAR_HOME, enterTerminal, restoreTerminal } from "./tty.js";

const CTRL_C = 0x03;

/**
 * @param {Buffer | string} chunk
 */
function isQuitKey(chunk) {
  if (chunk == null) return false;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  if (buf.length === 0) return false;
  if (buf[0] === CTRL_C) return true;
  const s = buf.toString("utf8");
  return s.includes("q") || s.includes("Q");
}

/**
 * @param {number} ms
 * @param {() => boolean} shouldStop
 */
export function sleep(ms, shouldStop) {
  const n = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => {
    if (n === 0 || shouldStop()) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      clearInterval(iv);
      resolve();
    };
    const t = setTimeout(done, n);
    const iv = setInterval(() => {
      if (shouldStop()) done();
    }, 50);
  });
}

/**
 * @param {import("./args.js").ParsedArgs} args
 * @param {object} deps
 */
export async function runDashboard(args, deps) {
  const write = deps.write;
  const stdin = deps.stdin;
  let quit = false;
  let restored = false;
  const shouldStop = () => quit || Boolean(deps.shouldStop?.());

  const restore = () => {
    if (restored) return;
    restored = true;
    restoreTerminal(write, stdin);
  };

  const frameOpts = () => ({
    columns: deps.columns(),
    rows: typeof deps.rows === "function" ? deps.rows() : 48,
    env: deps.env,
    isTTY: true,
    intervalSec: args.interval,
    full: Boolean(args.full),
    process: Boolean(args.process),
  });

  enterTerminal(write, stdin);
  const first = instantSnapshot();
  write(CLEAR_HOME + renderFrame(first, createHistory(), frameOpts()));

  const onData = (chunk) => {
    if (isQuitKey(chunk)) quit = true;
  };
  const onSig = () => {
    quit = true;
  };

  const proc = deps.process ?? process;
  if (stdin && typeof stdin.on === "function") stdin.on("data", onData);
  if (proc && typeof proc.on === "function") {
    proc.on("SIGINT", onSig);
    proc.on("SIGTERM", onSig);
  }

  /** @type {{ sample: Function, close?: Function } | null} */
  let sampler = null;
  try {
    sampler = deps.sampler || createSampler(undefined, { full: args.full, processes: args.process });
    let history = createHistory();
    /** @type {import("./sample.js").Snapshot | null} */
    let last = first;

    while (!shouldStop()) {
      let snap;
      try {
        snap = await sampler.sample();
      } catch {
        snap = last;
      }
      if (!snap) {
        await (deps.sleep || sleep)(args.interval * 1000, shouldStop);
        continue;
      }
      snap = mergeLastGood(last, snap);
      last = snap;
      history = appendHistory(history, snap);
      const frame = renderFrame(snap, history, frameOpts());
      write(CLEAR_HOME + frame);
      if (shouldStop()) break;
      await (deps.sleep || sleep)(args.interval * 1000, shouldStop);
    }
    return 0;
  } finally {
    try {
      sampler?.close?.();
    } catch {
      // ignore
    }
    if (stdin && typeof stdin.off === "function") stdin.off("data", onData);
    if (proc && typeof proc.off === "function") {
      proc.off("SIGINT", onSig);
      proc.off("SIGTERM", onSig);
    }
    restore();
  }
}
