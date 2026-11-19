/**
 * A38: season standings are fought out off the request thread. A full season of the largest honest pets takes seconds
 * to fight (measured 4.3 s on 2026-11-19), which on the request thread stalled every visitor; the runner fights each
 * set of entries once, in a worker thread with a time budget, keeps the result on disk, and meanwhile serves the last
 * standings it knows for that week, marked pending.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type SeasonEntry, type Standing, petCard, seasonStandings, standingsDigest } from "@lingxi/game";

const LINES = ["gentle", "bold", "curious"] as const;
import { type Compute, createStandingsRunner, workerCompute } from "../src/standings";

const entry = (i: number): SeasonEntry => ({ key: `k${i}`, pet: { name: `Pet${i}`, line: LINES[i % 3]!, stage: "child", card: petCard({ lessons: [] }), story: { days: 1, lessons: 0, nature: [] } }, at: i });
const WEEK = "2026-W47";

/** A compute that fights only when told to (or, once `flow` is called, at once), counting what it was asked. */
function held() {
  const asked: string[] = [];
  const waiting: Array<() => void> = [];
  let flowing = false;
  const compute: Compute = (week, entries) => {
    asked.push(entries.map((e) => e.key).join(","));
    return new Promise<Standing[]>((resolve) => {
      const go = () => resolve(seasonStandings(week, entries));
      if (flowing) go();
      else waiting.push(go);
    });
  };
  return {
    compute,
    asked,
    release: () => waiting.splice(0).forEach((go) => go()),
    flow: () => {
      flowing = true;
      waiting.splice(0).forEach((go) => go());
    },
  };
}

describe("season standings, fought off the request thread (A38)", () => {
  it("answers at once, pending, then with the standings once they are fought, fighting each set of entries once", async () => {
    const h = held();
    const runner = createStandingsRunner({ compute: h.compute });
    const entries = [entry(1), entry(2)];
    expect(runner.get(WEEK, entries)).toEqual({ standings: [], digest: "", pending: true });
    expect(runner.get(WEEK, entries).pending).toBe(true);
    h.release();
    await runner.idle();
    const fresh = runner.get(WEEK, entries);
    expect(fresh).toEqual({ standings: seasonStandings(WEEK, entries), digest: standingsDigest(seasonStandings(WEEK, entries)), pending: false });
    expect(h.asked).toEqual(["k1,k2"]);
  });

  it("serves the last standings while a new entry is fought in, and fights only the newest set waiting", async () => {
    const h = held();
    const runner = createStandingsRunner({ compute: h.compute });
    const two = [entry(1), entry(2)];
    runner.get(WEEK, two);
    h.release();
    await runner.idle();
    const three = [...two, entry(3)];
    const four = [...three, entry(4)];
    const five = [...four, entry(5)];
    // three is fought at once; four waits behind it, and five takes its place: only the newest set waits
    runner.get(WEEK, three);
    runner.get(WEEK, four);
    runner.get(WEEK, five);
    expect(runner.get(WEEK, five)).toMatchObject({ standings: seasonStandings(WEEK, two), pending: true });
    h.flow();
    await runner.idle();
    expect(runner.get(WEEK, five)).toMatchObject({ standings: seasonStandings(WEEK, five), pending: false });
    expect(h.asked).toEqual(["k1,k2", "k1,k2,k3", "k1,k2,k3,k4,k5"]);
  });

  it("keeps what it fought on disk: after a restart nothing is fought again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lx-standings-"));
    try {
      const file = join(dir, "standings.json");
      const h = held();
      const entries = [entry(1), entry(2)];
      const a = createStandingsRunner({ compute: h.compute, file });
      a.get(WEEK, entries);
      h.release();
      await a.idle();
      const again = held();
      const b = createStandingsRunner({ compute: again.compute, file });
      expect(b.get(WEEK, entries).pending).toBe(false);
      expect(again.asked).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives up on a fight past its budget, says so, and does not try the same set again at once", async () => {
    let clock = 0;
    const said: string[] = [];
    const never: Compute = () => new Promise(() => undefined);
    const runner = createStandingsRunner({ compute: never, budgetMs: 20, now: () => clock, log: (m) => said.push(m) });
    const entries = [entry(1)];
    runner.get(WEEK, entries);
    await runner.idle();
    expect(said.join("")).toMatch(/budget/);
    clock += 1_000;
    expect(runner.get(WEEK, entries).pending).toBe(true);
    await runner.idle();
    expect(said).toHaveLength(1);
  });

  it("fights in a real worker thread the same standings the game computes", async () => {
    const entries = [entry(1), entry(2), entry(3)];
    expect(await workerCompute(30_000)(WEEK, entries)).toEqual(seasonStandings(WEEK, entries));
  }, 60_000);

  it("stops a worker past its budget", async () => {
    const entries = [entry(1), entry(2), entry(3)];
    await expect(workerCompute(1)(WEEK, entries)).rejects.toThrow(/budget/);
  }, 60_000);
});
