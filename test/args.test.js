import assert from "node:assert/strict";
import { test } from "node:test";
import { helpText, parseArgs } from "../src/args.js";
import { CliError } from "../src/errors.js";

const sh = (...rest) => ["node", "yf-vitals", ...rest];

function throwsMessage(fn, re) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CliError);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, re);
    return true;
  });
}

test("bare argv is live dashboard at 1s", () => {
  const a = parseArgs(sh());
  assert.equal(a.help, false);
  assert.equal(a.version, false);
  assert.equal(a.interval, 1);
  assert.equal(a.lowPower, false);
  assert.equal(a.full, false);
  assert.equal(a.process, false);
});

test("--full and --process combine", () => {
  const a = parseArgs(sh("--full", "--process"));
  assert.equal(a.full, true);
  assert.equal(a.process, true);
  assert.equal(a.interval, 1);
  assert.match(helpText(), /--full/);
  assert.match(helpText(), /--process/);
});

test("--interval 1 and --interval=1", () => {
  assert.equal(parseArgs(sh("--interval", "1")).interval, 1);
  assert.equal(parseArgs(sh("--interval=0.5")).interval, 0.5);
  assert.equal(parseArgs(sh("--interval", "10")).interval, 10);
  assert.equal(parseArgs(sh("--interval", "0.25")).interval, 0.25);
});

test("--low-power wins over --interval", () => {
  const a = parseArgs(sh("--interval", "0.5", "--low-power"));
  assert.equal(a.lowPower, true);
  assert.equal(a.interval, 2);
  const b = parseArgs(sh("--low-power", "--interval=3"));
  assert.equal(b.interval, 2);
});

test("--interval 0 / 99 / missing value → error", () => {
  throwsMessage(() => parseArgs(sh("--interval", "0")), /0\.25 to 10/);
  throwsMessage(() => parseArgs(sh("--interval", "99")), /0\.25 to 10/);
  throwsMessage(() => parseArgs(sh("--interval")), /requires a number/);
  throwsMessage(() => parseArgs(sh("--interval=")), /requires a number/);
  throwsMessage(() => parseArgs(sh("--interval", "nope")), /requires a number/);
});

test("unknown flag errors", () => {
  throwsMessage(() => parseArgs(sh("--json")), /Unknown flag: --json/);
  throwsMessage(() => parseArgs(sh("--watch")), /Unknown flag: --watch/);
  throwsMessage(() => parseArgs(sh("cpu")), /Unknown argument: cpu/);
});

test("help and version skip interval validation", () => {
  assert.equal(parseArgs(sh("--help")).help, true);
  assert.equal(parseArgs(sh("-h")).help, true);
  assert.equal(parseArgs(sh("--version")).version, true);
  assert.equal(parseArgs(sh("-V")).version, true);
});

test("help text names the command and Node 20+", () => {
  const h = helpText();
  assert.match(h, /yf-vitals/);
  assert.match(h, /Node 20\+/);
  assert.match(h, /--low-power/);
  assert.match(h, /Mbps/);
});
