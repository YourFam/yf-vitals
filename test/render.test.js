import assert from "node:assert/strict";
import { test } from "node:test";
import { appendHistory, createHistory } from "../src/history.js";
import { buildGpuRow, renderFrame, splitSparkLine } from "../src/render.js";
import { createColor, stripAnsi } from "../src/color.js";
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

test("DSK and NET sparks are split R/W and ↑/↓", () => {
  let history = createHistory();
  history = appendHistory(history, snap());
  const frame = renderFrame(snap(), history, {
    columns: 120,
    env: { NO_COLOR: "1" },
    isTTY: true,
  });
  assert.match(frame, /R [▁▂▃▄▅▆▇█_=#-]+  W [▁▂▃▄▅▆▇█_=#-]+/);
  assert.match(frame, /↑ [▁▂▃▄▅▆▇█_=#-]+  ↓ [▁▂▃▄▅▆▇█_=#-]+/);
});

test("splitSparkLine shares max and fills unused slots with the floor tick", () => {
  const line = splitSparkLine("R", [10], "W", [100], 24, false);
  assert.match(line, /^R /);
  assert.match(line, /  W /);
  assert.equal(line.includes(" "), true);
  const bits = line.split(/\s+/).filter(Boolean);
  assert.equal(bits[0], "R");
  assert.equal(bits[2], "W");
});

test("USE row shows local capacity and extra disks; omitted when missing", () => {
  const none = renderFrame(snap(), createHistory(), {
    columns: 120,
    env: { NO_COLOR: "1" },
    isTTY: true,
  });
  assert.doesNotMatch(none, /^USE/m);
  const frame = renderFrame(
    snap({
      diskUse: {
        percent: 36,
        used: 332 * 1024 ** 3,
        total: 931 * 1024 ** 3,
        mount: "C:",
        others: [{ percent: 10, used: 178 * 1024 ** 3, total: 1863 * 1024 ** 3, mount: "D:" }],
      },
    }),
    createHistory(),
    { columns: 120, env: { NO_COLOR: "1" }, isTTY: true },
  );
  const ram = frame.indexOf("RAM");
  const use = frame.indexOf("USE");
  const dsk = frame.indexOf("DSK");
  assert.ok(ram >= 0 && use > ram && dsk > use);
  assert.match(frame, /C:/);
  assert.match(frame, /D:/);
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

test("bar fill is yellow at 72% and red at 90%", () => {
  const cpuLine = (frame) =>
    frame.split("\n").find((l) => stripAnsi(l).includes("CPU")) || "";
  const opts = { columns: 120, env: { TERM: "xterm-256color", WT_SESSION: "1" }, isTTY: true };
  const coolRam = { percent: 20, used: 1, total: 32 * 1024 ** 3 };
  const warm = cpuLine(
    renderFrame(snap({ cpu: { percent: 72 }, ram: coolRam }), createHistory(), opts),
  );
  const hot = cpuLine(
    renderFrame(snap({ cpu: { percent: 90 }, ram: coolRam }), createHistory(), opts),
  );
  const cool = cpuLine(
    renderFrame(snap({ cpu: { percent: 20 }, ram: coolRam }), createHistory(), opts),
  );
  assert.match(warm, /\u001b\[33m/);
  assert.match(hot, /\u001b\[31m/);
  assert.doesNotMatch(cool, /\u001b\[33m/);
  assert.doesNotMatch(cool, /\u001b\[31m/);
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
