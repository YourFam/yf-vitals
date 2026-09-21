import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../src/index.js";
import { runDashboard } from "../src/dashboard.js";
import { ENTER_ALT, LEAVE_ALT, SHOW_CURSOR } from "../src/tty.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "yf-vitals.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const sh = (...rest) => ["node", "yf-vitals", ...rest];

function spawnCli(args, extra = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...(extra.env || {}) },
    timeout: 8000,
    windowsHide: true,
  });
}

test("--help / -h exit 0, prints usage, does not enter alt-screen", () => {
  for (const flag of ["--help", "-h"]) {
    const r = spawnCli([flag]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /yf-vitals/);
    assert.match(r.stdout, /Usage:/);
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(all.includes(ENTER_ALT), false);
  }
});

test("--version / -V exit 0, prints the package version", () => {
  for (const flag of ["--version", "-V"]) {
    const r = spawnCli([flag]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), pkg.version);
    assert.equal(`${r.stdout}${r.stderr}`.includes(ENTER_ALT), false);
  }
});

test("unknown flag exit 1, no loop", () => {
  const r = spawnCli(["--json"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown flag: --json/);
  assert.equal(`${r.stdout}${r.stderr}`.includes(ENTER_ALT), false);
});

test("--interval 0 / 99 / missing value → exit 1", () => {
  for (const args of [["--interval", "0"], ["--interval", "99"], ["--interval"]]) {
    const r = spawnCli(args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(`${r.stdout}${r.stderr}`.includes(ENTER_ALT), false);
  }
});

test("non-TTY stdout → exit 1, message mentions terminal", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /terminal/);
  assert.equal(`${r.stdout}${r.stderr}`.includes(ENTER_ALT), false);
});

test("main() non-TTY does not call dashboard", async () => {
  let called = false;
  const err = [];
  const code = await main(sh(), {
    isTTY: () => false,
    err: (m) => err.push(m),
    log: () => {},
    dashboard: async () => {
      called = true;
      return 0;
    },
  });
  assert.equal(code, 1);
  assert.equal(called, false);
  assert.match(err.join("\n"), /terminal/);
});

test("dashboard loop restores terminal after injected stop", async () => {
  const writes = [];
  let ticks = 0;
  let raw = false;
  const stdin = {
    isTTY: true,
    setRawMode(v) {
      raw = v;
    },
    resume() {},
    on() {},
    off() {},
  };
  const fake = {
    ts: Date.now(),
    hostname: "BOX",
    osName: "Linux",
    physical: 4,
    logical: 8,
    ramTotal: 8 * 1024 ** 3,
    cpu: { percent: 10 },
    ram: { percent: 20, used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
    disk: { readBps: null, writeBps: null },
    net: { txBps: null, rxBps: null },
    gpu: null,
  };
  const code = await runDashboard(
    { interval: 1, lowPower: false, help: false, version: false },
    {
      write: (s) => writes.push(s),
      stdin,
      columns: () => 100,
      env: { NO_COLOR: "1" },
      process: { on() {}, off() {} },
      sampler: { sample: async () => fake },
      shouldStop: () => ticks >= 1,
      sleep: async () => {
        ticks += 1;
      },
    },
  );
  assert.equal(code, 0);
  assert.equal(raw, false);
  const out = writes.join("");
  assert.ok(out.includes(ENTER_ALT));
  assert.ok(out.includes(SHOW_CURSOR));
  assert.ok(out.includes(LEAVE_ALT));
  assert.match(out, /CPU/);
});
