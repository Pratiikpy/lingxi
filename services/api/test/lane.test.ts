import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createTapeoutCounter, withLane } from "../src/lane";

describe("Little Mars's tape-out count", () => {
  it("counts today's circuits from the day's first reading, and starts again each UTC day", async () => {
    let t = Date.UTC(2026, 10, 16, 0, 5);
    let total = 1000;
    const c = createTapeoutCounter(async () => ({ total, processors: 423 }), join(mkdtempSync(join(tmpdir(), "lane-")), "t.json"), () => t);
    expect(c.view()).toEqual({ ok: false });
    await c.tick();
    expect(c.view()).toEqual({ ok: true, today: 0, total: 1000, processors: 423, since: "00:05" });
    total = 1012;
    t += 3600_000;
    await c.tick();
    expect(c.view()).toMatchObject({ today: 12, total: 1012 });
    // the next UTC day, with yesterday's last reading too old to carry: today starts from this reading
    t = Date.UTC(2026, 10, 17, 0, 2);
    total = 1015;
    await c.tick();
    expect(c.view()).toEqual({ ok: true, today: 0, total: 1015, processors: 423, since: "00:02" });
    // and a reader that has not run today says nothing rather than a stale number
    t = Date.UTC(2026, 10, 18, 9);
    expect(c.view()).toEqual({ ok: false });
  });

  it("never takes a baseline counted the old way (C1), nor a reading that missed a processor", async () => {
    const t = Date.UTC(2026, 10, 22, 11);
    const file = join(mkdtempSync(join(tmpdir(), "lane-")), "t.json");
    // saved before C1, when each processor was counted one short: 325 fewer than the same chain counted now
    writeFileSync(file, JSON.stringify({ day: "2026-11-22", baseline: { at: t - 3600_000, total: 11_805, processors: 440 }, latest: { at: t - 60_000, total: 11_805, processors: 440 } }));
    let reading: { total: number; processors: number; complete?: boolean } = { total: 12_130, processors: 440, complete: true };
    const c = createTapeoutCounter(async () => reading, file, () => t);
    await c.tick();
    expect(c.view(), "the old baseline is set aside: today counts from this reading, not +325").toMatchObject({ ok: true, today: 0, total: 12_130 });
    // a reading in which some processor has never answered would undercount, then jump: it is not taken
    reading = { total: 12_000, processors: 440, complete: false };
    await c.tick();
    expect(c.view()).toMatchObject({ today: 0, total: 12_130 });
  });

  it("carries yesterday's last reading over midnight when it is recent", async () => {
    let t = Date.UTC(2026, 10, 16, 23, 55);
    let total = 500;
    const c = createTapeoutCounter(async () => ({ total, processors: 10 }), undefined, () => t);
    await c.tick();
    t = Date.UTC(2026, 10, 17, 0, 5);
    total = 503;
    await c.tick();
    expect(c.view()).toMatchObject({ ok: true, today: 3, since: "23:55" });
  });

  it("survives a restart and serves the view", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "lane-")), "t.json");
    const t = Date.UTC(2026, 10, 16, 8);
    await createTapeoutCounter(async () => ({ total: 40, processors: 2 }), file, () => t).tick();
    const again = createTapeoutCounter(async () => ({ total: 44, processors: 2 }), file, () => t + 60_000);
    await again.tick();
    const app = withLane(new Hono(), again);
    expect(await (await app.request("/api/lane/tapeouts")).json()).toMatchObject({ ok: true, today: 4, total: 44 });
  });
});
