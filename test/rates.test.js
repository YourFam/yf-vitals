import assert from "node:assert/strict";
import { test } from "node:test";
import { rateFromCounters } from "../src/rates.js";

test("rate helper: first sample null; second uses elapsed time", () => {
  assert.equal(rateFromCounters(null, 1000, null, 1000), null);
  assert.equal(rateFromCounters(undefined, 1000, 0, 1000), null);
  const bps = rateFromCounters(1000, 3000, 0, 1000);
  assert.equal(bps, 2000);
  const half = rateFromCounters(0, 500, 0, 2000);
  assert.equal(half, 250);
});

test("rate helper: wrap or zero dt is null", () => {
  assert.equal(rateFromCounters(5000, 1000, 0, 1000), null);
  assert.equal(rateFromCounters(0, 100, 5, 5), null);
});
