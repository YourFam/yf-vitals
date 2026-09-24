import assert from "node:assert/strict";
import { test } from "node:test";
import { appendHistory, createHistory } from "../src/history.js";
import { buildGpuRow, chooseLayout, renderFrame, splitSparkLine } from "../src/render.js";
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

test("each local partition gets its own bar; omitted when missing", () => {
  const none = renderFrame(snap(), createHistory(), {
    columns: 120,
    env: { NO_COLOR: "1" },
    isTTY: true,
  });
  assert.doesNotMatch(none, /^C:/m);
  const frame = renderFrame(
    snap({
      diskUse: [
        { percent: 36, used: 332 * 1024 ** 3, total: 931 * 1024 ** 3, mount: "C:" },
        { percent: 10, used: 178 * 1024 ** 3, total: 1863 * 1024 ** 3, mount: "D:" },
      ],
    }),
    createHistory(),
    { columns: 120, env: { NO_COLOR: "1" }, isTTY: true },
  );
  const ram = frame.indexOf("RAM");
  const dsk = frame.indexOf("DSK");
  const net = frame.indexOf("NET");
  const c = frame.indexOf("C:");
  const d = frame.indexOf("D:");
  assert.ok(ram >= 0 && dsk > ram && net > dsk && c > net && d > c);
  assert.match(frame, /C:.*36%/);
  assert.match(frame, /D:.*10%/);
  const lines = frame.split("\n");
  const cLine = lines.findIndex((line) => line.startsWith("C:"));
  assert.equal(lines[cLine + 1], "");
  assert.ok(lines[cLine + 2].startsWith("D:"));
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

test("--full widens bars, stacks a 4-row chart, and adds clock, cores, temp", () => {
  const frame = renderFrame(
    snap({
      ts: Date.UTC(2026, 0, 2, 14, 2, 11),
      cpu: { percent: 23, cores: [12, 55, 91] },
      gpu: { percent: 88, used: 12 * 1024 ** 3, total: 16 * 1024 ** 3, tempC: 67, powerW: 214 },
    }),
    createHistory(),
    { columns: 120, rows: 60, full: true, env: { NO_COLOR: "1", WT_SESSION: "1" }, isTTY: true, intervalSec: 1 },
  );
  const cpu = frame.split("\n").find((line) => line.startsWith("CPU"));
  const bar = cpu.match(/\[([█░]+)\]/);
  assert.equal(bar[1].length, 40);
  assert.match(frame, /67°C/);
  assert.match(frame, /214 W/);
  assert.match(frame, /cores /);
  const between = frame.split("\n");
  const cpuAt = between.findIndex((line) => line.startsWith("CPU"));
  const coresAt = between.findIndex((line) => line.includes("cores "));
  assert.equal(coresAt - cpuAt, 5);
  assert.match(frame.split("\n")[0], /\d{2}:\d{2}:\d{2}/);
});

test("SWP stays hidden while the page file still reads as 0%", () => {
  const idle = renderFrame(
    snap({
      swap: { percent: (25 * 1024 ** 2) / (6 * 1024 ** 3) * 100, used: 25 * 1024 ** 2, total: 6 * 1024 ** 3 },
    }),
    createHistory(),
    { columns: 100, rows: 40, full: true, env: { NO_COLOR: "1", WT_SESSION: "1" }, isTTY: true },
  );
  assert.doesNotMatch(idle, /SWP/);
  const busy = renderFrame(
    snap({
      swap: { percent: 20, used: 1.2 * 1024 ** 3, total: 6 * 1024 ** 3 },
    }),
    createHistory(),
    { columns: 100, rows: 40, full: true, env: { NO_COLOR: "1", WT_SESSION: "1" }, isTTY: true },
  );
  assert.match(busy, /SWP/);
  assert.match(busy, /20%/);
});

test("--full on a short window falls back to a one-line spark", () => {
  const frame = renderFrame(
    snap({ cpu: { percent: 23, cores: [10, 20] } }),
    createHistory(),
    { columns: 100, rows: 16, full: true, env: { NO_COLOR: "1" }, isTTY: true },
  );
  const lines = frame.split("\n");
  const cpuAt = lines.findIndex((line) => line.startsWith("CPU"));
  const coresAt = lines.findIndex((line) => line.includes("cores "));
  assert.equal(coresAt - cpuAt, 2);
});

test("--process prints side-by-side rankings and heats GPU percent", () => {
  const frame = renderFrame(
    snap({
      cpu: { percent: 10 },
      ram: { percent: 10, used: 1, total: 32 * 1024 ** 3 },
      processes: {
        cpu: [
          { name: "Cursor", percent: 22 },
          { name: "chrome", percent: 4 },
        ],
        ram: [{ name: "chrome", mem: 6.4 * 1024 ** 3 }],
        gpu: [{ name: "Helldivers2", percent: 94 }],
      },
    }),
    createHistory(),
    { columns: 100, rows: 40, process: true, env: { TERM: "xterm-256color", WT_SESSION: "1" }, isTTY: true },
  );
  const plain = stripAnsi(frame);
  assert.match(plain, /Cursor\s+22%/);
  assert.match(plain, /chrome\s+6\.4 GiB/);
  assert.match(plain, /Helldivers2\s+94%/);
  const hot = frame.split("\n").find((line) => stripAnsi(line).includes("Helldivers2"));
  assert.match(hot, /\u001b\[31m/);
});

test("--process without a GPU sample omits that column", () => {
  const frame = renderFrame(
    snap({
      processes: {
        cpu: [{ name: "node", percent: 7 }],
        ram: [{ name: "node", mem: 200 * 1024 ** 2 }],
        gpu: null,
      },
    }),
    createHistory(),
    { columns: 100, rows: 40, process: true, env: { NO_COLOR: "1" }, isTTY: true },
  );
  const header = frame.split("\n").find((line) => line.startsWith("CPU") && line.includes("RAM") && !line.includes("["));
  assert.ok(header);
  assert.equal(header.includes("GPU"), false);
});

test("chooseLayout shrinks charts before process rows", () => {
  const processes = {
    cpu: Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, percent: 8 - i })),
    ram: Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, mem: 1 })),
    gpu: [{ name: "game", percent: 90 }],
  };
  const wide = chooseLayout({
    full: true,
    rows: 80,
    columns: 120,
    gpu: true,
    partitions: 2,
    swap: false,
    cores: true,
    processes,
  });
  assert.equal(wide.chartH, 4);
  assert.equal(wide.procN, 8);
  assert.equal(wide.barWidth, 40);
  const short = chooseLayout({
    full: true,
    rows: 24,
    columns: 100,
    gpu: true,
    partitions: 2,
    swap: false,
    cores: true,
    processes,
  });
  assert.equal(short.chartH, 1);
  assert.ok(short.procN < 8);
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
