import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalCapacityVolume, shortMount, summarizeLocalDisks } from "../src/diskuse.js";

const GiB = 1024 ** 3;

test("skips Google Drive FAT32, iCloud, and network fs", () => {
  assert.equal(
    isLocalCapacityVolume({
      fs: "G:",
      type: "FAT32",
      mount: "G:",
      size: 999 * GiB,
      used: 300 * GiB,
    }),
    false,
  );
  assert.equal(
    isLocalCapacityVolume({
      fs: "smbfs",
      type: "smbfs",
      mount: "/Volumes/iCloud",
      size: 100 * GiB,
      used: 10 * GiB,
    }),
    false,
  );
  assert.equal(
    isLocalCapacityVolume({
      fs: "//server/share",
      type: "nfs",
      mount: "/Volumes/share",
      size: 100 * GiB,
      used: 10 * GiB,
    }),
    false,
  );
});

test("keeps local NTFS and APFS system volumes", () => {
  assert.equal(
    isLocalCapacityVolume({
      fs: "C:",
      type: "NTFS",
      mount: "C:",
      size: 931 * GiB,
      used: 332 * GiB,
    }),
    true,
  );
  assert.equal(
    isLocalCapacityVolume({
      fs: "/dev/disk3s5",
      type: "APFS",
      mount: "/System/Volumes/Data",
      size: 500 * GiB,
      used: 200 * GiB,
    }),
    true,
  );
  assert.equal(
    isLocalCapacityVolume({
      fs: "/dev/disk3s1",
      type: "APFS",
      mount: "/System/Volumes/Preboot",
      size: 20 * GiB,
      used: 1 * GiB,
    }),
    false,
  );
});

test("summarizeLocalDisks lists each local partition; drops G Drive and APFS clones", () => {
  const out = summarizeLocalDisks([
    { fs: "C:", type: "NTFS", mount: "C:", size: 931 * GiB, used: 332 * GiB, use: 35.7 },
    { fs: "D:", type: "NTFS", mount: "D:", size: 1863 * GiB, used: 178 * GiB, use: 9.5 },
    { fs: "G:", type: "FAT32", mount: "G:", size: 931 * GiB, used: 362 * GiB, use: 38.9 },
  ]);
  assert.ok(out);
  assert.equal(out.length, 2);
  assert.equal(out[0].mount, "C:");
  assert.equal(out[1].mount, "D:");
  const mac = summarizeLocalDisks([
    { fs: "/dev/disk3s1", type: "APFS", mount: "/", size: 500 * GiB, used: 200 * GiB, use: 40 },
    {
      fs: "/dev/disk3s5",
      type: "APFS",
      mount: "/System/Volumes/Data",
      size: 500 * GiB,
      used: 200 * GiB,
      use: 40,
    },
  ]);
  assert.ok(mac);
  assert.equal(mac.length, 1);
  assert.equal(mac[0].mount, "Data");
});

test("shortMount", () => {
  assert.equal(shortMount("C:"), "C:");
  assert.equal(shortMount("D:\\"), "D:");
  assert.equal(shortMount("/System/Volumes/Data"), "Data");
  assert.equal(shortMount("/"), "/");
});
