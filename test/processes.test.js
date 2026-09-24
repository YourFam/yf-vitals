import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNvidiaPmon, readProcessBlock } from "../src/processes.js";

const PMON = `
# gpu         pid  type    sm   mem   enc   dec   command
# Idx           #   C/G     %     %     %     %   name
    0       14835     G     90    10     0     0   Helldivers2.exe
    0       14945     C     45     5     0     0   python
# blank
`;

test("parseNvidiaPmon reads sm% and skips comments", () => {
  const rows = parseNvidiaPmon(PMON);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pid, 14835);
  assert.equal(rows[0].sm, 90);
  assert.equal(rows[0].command, "Helldivers2.exe");
  assert.equal(parseNvidiaPmon(null), null);
});

test("readProcessBlock groups names and drops idle", async () => {
  const lib = {
    processes: async () => ({
      list: [
        { name: "chrome.exe", pid: 1, cpu: 10, memRss: 2 * 1024 * 1024 },
        { name: "C:\\Program Files\\Google\\chrome.exe", pid: 2, cpu: 5, memRss: 1024 * 1024 },
        { name: "System Idle Process", pid: 0, cpu: 90, memRss: 0 },
        { name: "node.exe", pid: 3, cpu: 20, memRss: 100 * 1024 },
      ],
    }),
  };
  const block = await readProcessBlock(lib, async () => [
    { pid: 3, sm: 4, command: "node.exe" },
    { pid: 9, sm: 94, command: "Helldivers2.exe" },
  ]);
  assert.equal(block.cpu[0].name, "node");
  assert.equal(block.cpu[0].percent, 20);
  assert.equal(block.cpu[1].name, "chrome");
  assert.equal(block.cpu[1].percent, 15);
  assert.equal(block.cpu.some((row) => /idle/i.test(row.name)), false);
  assert.equal(block.ram[0].name, "chrome");
  assert.equal(block.gpu[0].name, "Helldivers2");
  assert.equal(block.gpu[0].percent, 94);
  assert.equal(block.gpu[1].name, "node");
});

test("missing nvidia-smi omits the GPU column", async () => {
  const lib = {
    processes: async () => ({
      list: [{ name: "node.exe", pid: 1, cpu: 3, memRss: 10 * 1024 }],
    }),
  };
  const block = await readProcessBlock(lib, async () => null);
  assert.equal(block.gpu, null);
  assert.equal(block.cpu[0].name, "node");
});
