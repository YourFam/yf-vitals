import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistory } from "../src/history.js";
import { buildGpuRow, renderFrame } from "../src/render.js";
import { createColor } from "../src/color.js";
import { restoreTerminal, ENTER_ALT, HIDE_CURSOR, SHOW_CURSOR, LEAVE_ALT } from "../src/tty.js";
import { pickGpu } from "../src/sample.js";

function snap(over = {}) {
  return {
    ts: 1,
    hostname: "BOX",
    osName: "Windows 11",
    physical: 16,
    logical: 24,
    ramTotal: 32 * 1024 ** 3,
    cpu: { percent: 72 },
    ram: { percent: 69, used: 22.1 * 1024 ** 3, total: 32 * 1024 ** 3 },
    disk: { readBps: 12 * 1024 ** 2, writeBps: 3.1 * 1024 ** 2 },
    net: { txBps: 1.2e6 / 8, rxBps: 4.8e6 / 8 },
    gpu: null,
    ...over,
  };
}

test("GPU row builder returns null when telemetry is missing", () => {
  const color = createColor({ isTTY: false, env: { NO_COLOR: "1" } });
  assert.equal(buildGpuRow(null, { history: [], ascii: false, color, sparkW: 16 }), null);
  assert.equal(buildGpuRow(undefined, { history: [], ascii: false, color, sparkW: 16 }), null);
  assert.equal(pickGpu([]), null);
  assert.equal(pickGpu([{ model: "ghost" }]), null);
});

test("GPU row builder returns a row when present", () => {
  const color = createColor({ isTTY: false, env: { NO_COLOR: "1" } });
  const lines = buildGpuRow(
    { percent: 40, used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
    { history: [10, 20, 40], ascii: false, color, sparkW: 16 },
  );
  assert.ok(Array.isArray(lines));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /GPU/);
  assert.match(lines[0], /40%/);
  assert.match(lines[0], /8\.0 GiB/);
});

test("NO_COLOR=1 → rendered frame has no ANSI CSI", () => {
  const frame = renderFrame(snap(), createHistory(), {
    columns: 120,
    env: { NO_COLOR: "1" },
    isTTY: true,
    intervalSec: 1,
  });
  assert.equal(/\u001b\[[0-9;]*m/.test(frame), false);
  assert.match(frame, /yf-vitals/);
  assert.match(frame, /CPU/);
  assert.match(frame, /RAM/);
  assert.match(frame, /DSK/);
  assert.match(frame, /NET/);
  assert.match(frame, /Mbps/);
  assert.match(frame, /q quit/);
  assert.doesNotMatch(frame, /^GPU/m);
});

test("GPU appears between RAM and DSK when present", () => {
  const frame = renderFrame(
    snap({ gpu: { percent: 10, used: 1, total: 2 * 1024 ** 3 } }),
    createHistory(),
    { columns: 120, env: { NO_COLOR: "1" }, isTTY: true },
  );
  const ram = frame.indexOf("RAM");
  const gpu = frame.indexOf("GPU");
  const dsk = frame.indexOf("DSK");
  assert.ok(ram >= 0 && gpu > ram && dsk > gpu);
});

test("color frame emits CSI when TTY and NO_COLOR unset", () => {
  const frame = renderFrame(snap(), createHistory(), {
    columns: 120,
    env: {},
    isTTY: true,
    intervalSec: 1,
  });
  assert.match(frame, /\u001b\[[0-9;]*m/);
});

test("restoreTerminal restores cursor and alt-screen flags", () => {
  const chunks = [];
  let raw = true;
  const stdin = {
    isTTY: true,
    isRaw: true,
    setRawMode(v) {
      raw = v;
      this.isRaw = v;
    },
  };
  restoreTerminal((s) => chunks.push(s), stdin);
  const out = chunks.join("");
  assert.ok(out.includes(SHOW_CURSOR));
  assert.ok(out.includes(LEAVE_ALT));
  assert.equal(raw, false);
  assert.ok(ENTER_ALT);
  assert.ok(HIDE_CURSOR);
});
