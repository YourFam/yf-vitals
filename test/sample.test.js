import assert from "node:assert/strict";
import { test } from "node:test";
import { useAscii } from "../src/ascii.js";
import { appendHistory, createHistory, pushSample } from "../src/history.js";
import { parseDiskCounterLine } from "../src/disk.js";
import {
  cpuCoreTotals,
  cpuIdleTotal,
  cpuPercentFromDelta,
  gpuBytes,
  instantSnapshot,
  mergeLastGood,
  pickGpu,
  shortOsName,
  sumNetBytes,
} from "../src/sample.js";

test("instantSnapshot is sync and uses os only", () => {
  const t0 = Date.now();
  const s = instantSnapshot();
  assert.ok(Date.now() - t0 < 50);
  assert.ok(s.hostname);
  assert.ok(s.ramTotal > 0);
  assert.ok(s.ram);
  assert.equal(s.cpu, null);
  assert.equal(s.gpu, null);
  assert.equal(s.disk.readBps, null);
});

test("pickGpu null without telemetry, row object when present", () => {
  assert.equal(pickGpu(null), null);
  assert.equal(pickGpu([]), null);
  assert.equal(pickGpu([{ vendor: "Acme" }]), null);
  assert.equal(pickGpu([{ model: "AMD iGPU", vram: 2048 }]), null);
  const g = pickGpu([{ utilizationGpu: 55, memoryUsed: 2048, memoryTotal: 8192 }]);
  assert.ok(g);
  assert.equal(g.percent, 55);
  assert.equal(g.used, 2048 * 1024 * 1024);
  assert.equal(g.total, 8192 * 1024 * 1024);
});

test("pickGpu keeps temperature and power when present", () => {
  const g = pickGpu([
    { utilizationGpu: 12, memoryUsed: 1024, memoryTotal: 8192, temperatureGpu: 67, powerDraw: 214 },
  ]);
  assert.equal(g.tempC, 67);
  assert.equal(g.powerW, 214);
  const bare = pickGpu([{ utilizationGpu: 1, memoryUsed: 1, memoryTotal: 2 }]);
  assert.equal(bare.tempC, null);
  assert.equal(bare.powerW, null);
});

test("pickGpu keeps 0% util and prefers the card with VRAM telemetry", () => {
  const idle = pickGpu([{ utilizationGpu: 0, memoryUsed: 2211, memoryTotal: 16303 }]);
  assert.ok(idle);
  assert.equal(idle.percent, 0);
  const mixed = pickGpu([
    { model: "AMD", vram: 2048 },
    { utilizationGpu: 0, memoryUsed: 2211, memoryTotal: 16303 },
  ]);
  assert.equal(mixed.percent, 0);
  assert.equal(mixed.total, 16303 * 1024 * 1024);
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

test("sumNetBytes skips loopback and virtual NICs", () => {
  const s = sumNetBytes([
    { iface: "lo", rx_bytes: 99, tx_bytes: 99 },
    { iface: "vEthernet (WSL (Hyper-V firewall))", operstate: "up", rx_bytes: 500, tx_bytes: 500 },
    { iface: "eth0", operstate: "up", rx_bytes: 10, tx_bytes: 20 },
  ]);
  assert.equal(s.rx, 10);
  assert.equal(s.tx, 20);
});

test("per-core totals match the summed idle counter", () => {
  const cpus = [
    { times: { user: 10, nice: 0, sys: 30, irq: 10, idle: 60 } },
    { times: { user: 5, nice: 1, sys: 4, irq: 0, idle: 20 } },
  ];
  const cores = cpuCoreTotals(cpus, true);
  const sum = cpuIdleTotal(cpus, true);
  assert.equal(cores.length, 2);
  assert.equal(
    cores.reduce((n, c) => n + c.total, 0),
    sum.total,
  );
  assert.equal(cores[0].total, 100);
});

test("Windows cpu times do not double-count irq inside sys", () => {
  const cpus = [
    { times: { user: 10, nice: 0, sys: 30, irq: 10, idle: 60 } },
  ];
  const win = cpuIdleTotal(cpus, true);
  const unix = cpuIdleTotal(cpus, false);
  assert.equal(win.total, 100);
  assert.equal(unix.total, 110);
});

test("shortOsName collapses Windows distro strings", () => {
  assert.equal(shortOsName({ distro: "Microsoft Windows 11 Pro" }), "Windows 11");
  assert.equal(shortOsName({ distro: "Windows 10 Home" }), "Windows 10");
});

test("parseDiskCounterLine", () => {
  assert.deepEqual(parseDiskCounterLine("10 20"), { rx: 10, wx: 20, netRx: 0, netTx: 0 });
  assert.deepEqual(parseDiskCounterLine("10 20 30 40"), { rx: 10, wx: 20, netRx: 30, netTx: 40 });
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
  assert.deepEqual(h.dskR, []);
  assert.deepEqual(h.dskW, []);
  assert.deepEqual(h.netUp, []);
  assert.deepEqual(h.netDn, []);
  assert.deepEqual(h.gpu, []);
});
