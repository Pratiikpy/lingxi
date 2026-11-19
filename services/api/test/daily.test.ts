/**
 * A34: the daily challenge's block, found once by the server and served same-origin. The browser no longer searches the
 * public nodes itself (a node's rate-limit reply drops its CORS headers and shows as blocked requests in the console).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DAY_MS, dayIndex } from "@lingxi/game";
import { type ChainHead, createDailyBlocks, withDaily } from "../src/daily";

/** A chain with one block a second from `start` (seconds) to `end`, hashes made from the block number. */
function chain(start: number, end: number) {
  let reads = 0;
  let failing = false;
  const head = async (): Promise<ChainHead> => {
    if (failing) throw new Error("node down");
    reads++;
    return { number: end - start, timestamp: end };
  };
  const block = async (n: number) => {
    if (failing) throw new Error("node down");
    reads++;
    return { number: n, timestamp: start + n, hash: `0x${n.toString(16).padStart(64, "0")}` as `0x${string}` };
  };
  return {
    reader: { head, block },
    reads: () => reads,
    fail: (on: boolean) => {
      failing = on;
    },
  };
}

const NOW = Date.UTC(2026, 10, 19, 14, 0);
const TODAY = dayIndex(NOW);
const MIDNIGHT = (TODAY * DAY_MS) / 1000;

describe("today's challenge block, found by the server (A34)", () => {
  it("finds the first block at or after the day's midnight UTC, once, and keeps it", async () => {
    const c = chain(MIDNIGHT - 3 * 86_400, NOW / 1000);
    const daily = createDailyBlocks(c.reader, { now: () => NOW });
    const got = await daily.get(TODAY);
    expect(got).toEqual({ ok: true, day: TODAY, block: 3 * 86_400, hash: `0x${(3 * 86_400).toString(16).padStart(64, "0")}` });
    const reads = c.reads();
    expect(await daily.get(TODAY)).toEqual(got);
    expect(c.reads(), "a second ask reads nothing").toBe(reads);
  });

  it("shares one search between asks that arrive together", async () => {
    const c = chain(MIDNIGHT - 86_400, NOW / 1000);
    const daily = createDailyBlocks(c.reader, { now: () => NOW });
    const [a, b] = await Promise.all([daily.get(TODAY), daily.get(TODAY)]);
    expect(a).toEqual(b);
    const once = c.reads();
    const alone = chain(MIDNIGHT - 86_400, NOW / 1000);
    await createDailyBlocks(alone.reader, { now: () => NOW }).get(TODAY);
    expect(once).toBe(alone.reads());
  });

  it("says a day not yet begun is not yet, refuses days long gone, and keeps nothing when the nodes fail", async () => {
    const c = chain(MIDNIGHT - 86_400, NOW / 1000);
    let clock = NOW;
    const daily = createDailyBlocks(c.reader, { now: () => clock });
    expect(await daily.get(TODAY + 1)).toEqual({ ok: false, reason: "notYet" });
    expect(await daily.get(TODAY - 31)).toEqual({ ok: false, reason: "tooOld" });
    c.fail(true);
    expect(await daily.get(TODAY)).toEqual({ ok: false, reason: "unavailable" });
    c.fail(false);
    const reads = c.reads();
    clock += 10_000;
    expect(await daily.get(TODAY), "nodes that just failed are not asked again at once").toEqual({ ok: false, reason: "unavailable" });
    expect(c.reads()).toBe(reads);
    clock += 25_000;
    expect((await daily.get(TODAY)).ok, "a failure is not kept: a later ask searches again").toBe(true);
  });

  it("says not yet when the chain has not reached the day's midnight", async () => {
    const c = chain(MIDNIGHT - 86_400, MIDNIGHT - 5);
    expect(await createDailyBlocks(c.reader, { now: () => NOW }).get(TODAY)).toEqual({ ok: false, reason: "notYet" });
  });

  it("reads its blocks back from its file after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lingxi-daily-"));
    try {
      const file = join(dir, "daily.json");
      const c = chain(MIDNIGHT - 86_400, NOW / 1000);
      const first = await createDailyBlocks(c.reader, { now: () => NOW, file }).get(TODAY);
      const fresh = chain(MIDNIGHT - 86_400, NOW / 1000);
      expect(await createDailyBlocks(fresh.reader, { now: () => NOW, file }).get(TODAY)).toEqual(first);
      expect(fresh.reads(), "nothing read after a restart").toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers over HTTP with 200 for every outcome a player can meet, 400 for a malformed day", async () => {
    const c = chain(MIDNIGHT - 86_400, NOW / 1000);
    const app = withDaily(new Hono(), createDailyBlocks(c.reader, { now: () => NOW }));
    const ok = await app.request(`/api/daily/${TODAY}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true);
    expect(ok.headers.get("cache-control")).toContain("immutable");
    const later = await app.request(`/api/daily/${TODAY + 1}`);
    expect([later.status, await later.json()]).toEqual([200, { ok: false, reason: "notYet" }]);
    expect(later.headers.get("cache-control")).toBe("no-store");
    for (const bad of ["x", "-1", "1.5", "99999999999"]) expect((await app.request(`/api/daily/${bad}`)).status, bad).toBe(400);
  });
});
