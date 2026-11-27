/**
 * R45: a store write that fails must not hide behind a healthy report. On 2026-11-27 the PC's disk filled, the indexer,
 * goals, sales and circuits stores failed to save (ENOSPC), and /api/health still said every job was ok. Every store
 * writes through durable.ts's writeFlushed, which now notes a failed write; the health report gives the data disk's
 * free space and the writes that failed; and the public answer says `store: false` while the server cannot save, so the
 * outside check can tell the owner.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveJson, writeFlushed } from "../src/durable";
import { DISK_ALARM_GB, diskFreeGb, forgetStorage, storeOk, watchDisk, writeFailures } from "../src/storage";
import { createApp } from "../src/server";
import { healthDetail } from "../src/boot/health";
import { createJobs } from "../src/jobs";
import { createTokenBudget } from "../src/tokenBudget";

afterEach(() => forgetStorage());

const dir = () => mkdtempSync(join(tmpdir(), "lingxi-storage-"));
const MIN = 60_000;

describe("a store write that fails is noted (R45)", () => {
  it("still throws to its caller, and is counted with its file and its reason", () => {
    const missing = join(dir(), "no-such-folder", "indexer.json");
    expect(() => saveJson(missing, { a: 1 })).toThrow();
    const f = writeFailures();
    expect(f.lastDay).toBe(1);
    expect(f.last).toMatchObject({ file: "indexer.json.tmp", code: "ENOENT" });
  });

  it("a write that works is not counted", () => {
    writeFlushed(join(dir(), "goals.json"), "{}");
    expect(writeFailures()).toEqual({ lastDay: 0, last: null });
  });

  it("forgets failures older than a day", () => {
    const t0 = Date.now();
    expect(() => writeFlushed(join(dir(), "x", "sales.json"), "{}")).toThrow();
    expect(writeFailures(t0 + 23 * 60 * MIN).lastDay).toBe(1);
    expect(writeFailures(t0 + 25 * 60 * MIN).lastDay).toBe(0);
  });
});

describe("whether the server can save (R45)", () => {
  it("can, with no failure and room on the disk", () => {
    watchDisk(dir());
    expect(storeOk()).toBe(true);
  });

  it("cannot for ten minutes after a failed write", () => {
    const t0 = Date.now();
    expect(() => writeFlushed(join(dir(), "x", "circuits.json"), "{}")).toThrow();
    expect(storeOk(t0 + 9 * MIN)).toBe(false);
    expect(storeOk(t0 + 11 * MIN)).toBe(true);
  });

  it("cannot when the data disk has less free than the alarm", () => {
    watchDisk(dir(), () => DISK_ALARM_GB - 0.5);
    expect(storeOk()).toBe(false);
    watchDisk(dir(), () => DISK_ALARM_GB + 0.5);
    expect(storeOk()).toBe(true);
  });

  it("reads this disk's free space", () => {
    expect(diskFreeGb(dir())).toBeGreaterThan(0);
  });
});

describe("the health answers say so (R45)", () => {
  it("the public answer carries store: true, and false while the server cannot save", async () => {
    const app = createApp(null);
    expect(await (await app.request("/api/health")).json()).toMatchObject({ ok: true, store: true });
    expect(() => writeFlushed(join(dir(), "x", "indexer.json"), "{}")).toThrow();
    expect(await (await app.request("/api/health")).json()).toMatchObject({ ok: true, store: false });
  });

  it("the detail gives the data disk's free space and the writes that failed", async () => {
    const data = dir();
    watchDisk(data, () => 3.25);
    expect(() => writeFlushed(join(data, "x", "goals.json"), "{}")).toThrow();
    const r = await healthDetail({
      jobs: createJobs(() => {}),
      client: null,
      modelBudget: createTokenBudget({ perDay: 1_000 }),
      relayer: null,
      watch: {},
      dataDir: data,
    }).detail();
    expect(r.disk).toEqual({ freeGb: 3.25, low: true, alarmGb: DISK_ALARM_GB });
    expect(r.writes).toMatchObject({ lastDay: 1, last: { file: "goals.json", code: "ENOENT" } });
  });
});
