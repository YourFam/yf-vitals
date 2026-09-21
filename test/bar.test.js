import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASC_BAR_EMPTY,
  ASC_BAR_FILLED,
  ASC_SPARK,
  BAR_WIDTH,
  UNI_BAR_EMPTY,
  UNI_BAR_FILLED,
  UNI_SPARK,
  bar,
  heatLevel,
  sparkWidth,
  sparkline,
} from "../src/bar.js";

test("bar clamps; 0 empty; 100 filled; 150 filled", () => {
  const empty = bar(0, BAR_WIDTH);
  assert.equal(empty.length, 20);
  assert.equal(empty, UNI_BAR_EMPTY.repeat(20));
  assert.equal(bar(100, 20), UNI_BAR_FILLED.repeat(20));
  assert.equal(bar(150, 20), UNI_BAR_FILLED.repeat(20));
  assert.equal(bar(-20, 20), UNI_BAR_EMPTY.repeat(20));
  assert.equal(bar(50, 10), UNI_BAR_FILLED.repeat(5) + UNI_BAR_EMPTY.repeat(5));
});

test("bar ASCII charset", () => {
  assert.equal(
    bar(100, 8, { filled: ASC_BAR_FILLED, empty: ASC_BAR_EMPTY }),
    ASC_BAR_FILLED.repeat(8),
  );
  assert.equal(
    bar(0, 8, { filled: ASC_BAR_FILLED, empty: ASC_BAR_EMPTY }),
    ASC_BAR_EMPTY.repeat(8),
  );
});

test("sparkline length equals width; empty is lowest tick, not spaces", () => {
  assert.equal(sparkline([], 16).length, 16);
  assert.equal(sparkline([], 16), UNI_SPARK[0].repeat(16));
  assert.equal(sparkline([], 16, { ascii: true }), ASC_SPARK[0].repeat(16));
  const short = sparkline([0, 50, 100], 16, { max: 100 });
  assert.equal(short.length, 16);
  assert.equal(short.slice(0, 13), UNI_SPARK[0].repeat(13));
  assert.equal(sparkline([10, 20, 30, 40], 4).length, 4);
});

test("sparkline ASCII vs Unicode charset", () => {
  const uni = sparkline([0, 100], 2, { ascii: false, max: 100 });
  assert.equal(uni[0], UNI_SPARK[0]);
  assert.equal(uni[1], UNI_SPARK[UNI_SPARK.length - 1]);
  const asc = sparkline([0, 100], 2, { ascii: true, max: 100 });
  assert.equal(asc[0], ASC_SPARK[0]);
  assert.equal(asc[1], ASC_SPARK[ASC_SPARK.length - 1]);
  assert.notEqual(uni, asc);
});

test("sparkWidth is min(60, columns-36), at least 16", () => {
  assert.equal(sparkWidth(200), 60);
  assert.equal(sparkWidth(80), 44);
  assert.equal(sparkWidth(40), 16);
});

test("heatLevel bands", () => {
  assert.equal(heatLevel(0), "ok");
  assert.equal(heatLevel(49), "ok");
  assert.equal(heatLevel(50), "warm");
  assert.equal(heatLevel(79), "warm");
  assert.equal(heatLevel(80), "hot");
  assert.equal(heatLevel(150), "hot");
});
