#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require.resolve("@yourfam/yf-vitals/bin/yf-vitals.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
