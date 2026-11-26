/**
 * P8: a dead RPC shows on /api/health within a minute. The report read the chain's head and showed null when it could
 * not, so a dead node was a blank, never named, and the indexer's job turned "failing" only after three failures in a
 * row. The report now says whether the chain answered, and why not, on every refresh (it is cached for 30 s).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { healthDetail } from "../src/boot/health";
import { createJobs } from "../src/jobs";
import { createTokenBudget } from "../src/tokenBudget";

afterEach(() => {
  vi.useRealTimers();
});

const reportWith = (head: () => Promise<bigint>) =>
  healthDetail({
    jobs: createJobs(() => {}),
    client: null,
    modelBudget: createTokenBudget({ perDay: 1_000 }),
    relayer: null,
    watch: { head, indexed: () => 100 },
    dataDir: mkdtempSync(join(tmpdir(), "lingxi-health-")),
  });

describe("the health report says whether the chain answers (P8)", () => {
  it("a chain that answers is ok, with the indexer's lag", async () => {
    const r = await reportWith(async () => 105n).detail();
    expect(r.chain).toBe("ok");
    expect(r.indexerLagBlocks).toBe(5);
  });

  it("a chain that does not answer is named unreachable, with its reason", async () => {
    const r = await reportWith(() => Promise.reject(new Error("fetch failed: connect ECONNREFUSED"))).detail();
    expect(r.chain).toMatch(/^unreachable: fetch failed: connect ECONNREFUSED/);
    expect(r.indexerLagBlocks).toBeNull();
  });

  it("an RPC killed under a running server shows within a minute, and its return shows too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let up = true;
    const h = reportWith(() => (up ? Promise.resolve(105n) : Promise.reject(new Error("fetch failed"))));
    expect((await h.detail()).chain).toBe("ok");
    up = false;
    vi.advanceTimersByTime(60_000);
    expect((await h.detail()).chain, "down within a minute").toMatch(/^unreachable/);
    up = true;
    vi.advanceTimersByTime(60_000);
    expect((await h.detail()).chain, "back within a minute").toBe("ok");
  });
});
