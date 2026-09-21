import assert from "node:assert/strict";
import { test } from "node:test";
import { useAscii } from "../src/ascii.js";
import { appendHistory, createHistory, pushSample } from "../src/history.js";
import { parseDiskCounterLine } from "../src/disk.js";
import {
  cpuPercentFromDelta,
  gpuBytes,
  mergeLastGood,
  pickGpu,
  shortOsName,
  sumNetBytes,
} from "../src/sample.js";

test("pickGpu null without telemetry, row object when present", () => {
  assert.equal(pickGpu(null), null);
  assert.equal(pickGpu([]), null);
  assert.equal(pickGpu([{ vendor: "Acme" }]), null);
  const g = pickGpu([{ utilizationGpu: 55, memoryUsed: 2048, memoryTotal: 8192 }]);
  assert.ok(g);
  assert.equal(g.percent, 55);
  assert.equal(g.used, 2048 * 1024 * 1024);
  assert.equal(g.total, 8192 * 1024 * 1024);
});

test("gpuBytes treats large numbers as bytes", () => {
  assert.equal(gpuBytes(8 * 1024 ** 3, null), 8 * 1024 ** 3);
  assert.equal(gpuBytes(8192, null), 8192 * 1024 * 1024);
  assert.equal(gpuBytes(null, 4096), 4096 * 1024 * 1024);
});

test("cpu idle-delta percent", () => {
  assert.equal(cpuPercentFromDelta(null, { idle: 10, total: 20 }), null);
  const pct = cpuPercentFromDelta({ idle: 80, total: 100 }, { idle: 85, total: 200 });
  assert.equal(pct, 95);
});

test("mergeLastGood keeps previous row on null", () => {
  const last = {
    ts: 1,
    hostname: "a",
    osName: "Linux",
    physical: 2,
    logical: 4,
    ramTotal: 1,
    cpu: { percent: 9 },
    ram: { percent: 1, used: 1, total: 2 },
    disk: { readBps: 3, writeBps: 4 },
    net: { txBps: 5, rxBps: 6 },
    gpu: { percent: 7, used: 8, total: 9 },
  };
  const merged = mergeLastGood(last, {
    ts: 2,
    hostname: "a",
    osName: "Linux",
    physical: 2,
    logical: 4,
    ramTotal: 1,
    cpu: null,
    ram: null,
    disk: null,
    net: null,
    gpu: null,
  });
  assert.equal(merged.cpu.percent, 9);
  assert.equal(merged.gpu.percent, 7);
});

test("sumNetBytes skips loopback", () => {
  const s = sumNetBytes([
    { iface: "lo", rx_bytes: 99, tx_bytes: 99 },
    { iface: "eth0", rx_bytes: 10, tx_bytes: 20 },
  ]);
  assert.equal(s.rx, 10);
  assert.equal(s.tx, 20);
});

test("shortOsName collapses Windows distro strings", () => {
  assert.equal(shortOsName({ distro: "Microsoft Windows 11 Pro" }), "Windows 11");
  assert.equal(shortOsName({ distro: "Windows 10 Home" }), "Windows 10");
});

test("parseDiskCounterLine", () => {
  assert.deepEqual(parseDiskCounterLine("10 20"), { rx: 10, wx: 20 });
  assert.equal(parseDiskCounterLine("n n"), null);
});

test("useAscii from env", () => {
  assert.equal(useAscii({ YF_VITALS_ASCII: "1", TERM: "xterm-256color", WT_SESSION: "1" }), true);
  assert.equal(useAscii({ TERM: "xterm-256color" }), false);
  assert.equal(useAscii({ TERM: "dumb" }), true);
  assert.equal(useAscii({ TERM: "dumb", WT_SESSION: "wt" }), false);
});

test("pushSample rings at 60", () => {
  let buf = [];
  for (let i = 0; i < 65; i += 1) buf = pushSample(buf, i, 60);
  assert.equal(buf.length, 60);
  assert.equal(buf[0], 5);
  assert.equal(buf[59], 64);
});

test("appendHistory skips null rates", () => {
  const h = appendHistory(createHistory(), {
    ts: 1,
    hostname: "h",
    osName: "o",
    physical: 1,
    logical: 1,
    ramTotal: 1,
    cpu: { percent: 1 },
    ram: { percent: 2, used: 1, total: 2 },
    disk: { readBps: null, writeBps: null },
    net: { txBps: null, rxBps: null },
    gpu: null,
  });
  assert.deepEqual(h.cpu, [1]);
  assert.deepEqual(h.dsk, []);
  assert.deepEqual(h.gpu, []);
});
