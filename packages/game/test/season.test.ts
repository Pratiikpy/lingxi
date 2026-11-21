import { describe, expect, it } from "vitest";
import { petCard } from "../src/family";
import { MAX_ENTRIES, entryGates, placeTier, previousWeek, seasonStandings, standingsDigest, weekBounds, weekOf, type SeasonEntry } from "../src/season";

const LINES = ["gentle", "bold", "curious"] as const;
const entry = (i: number, lessons: unknown[] = [], stage = "child"): SeasonEntry => ({
  key: `e${String(i).padStart(3, "0")}`,
  pet: { name: `Pet${i}`, line: LINES[i % 3]!, stage: stage as "child", card: petCard({ lessons: lessons as never }), story: { days: 1, lessons: 0, nature: [] } },
  at: i,
});

describe("weeks", () => {
  it("ISO weeks start on Monday UTC and round-trip", () => {
    expect(weekOf(Date.UTC(2026, 10, 15, 12))).toBe("2026-W46"); // Sunday 15 Nov 2026
    expect(weekOf(Date.UTC(2026, 10, 16, 0))).toBe("2026-W47"); // Monday
    expect(weekOf(Date.UTC(2021, 0, 3))).toBe("2020-W53");
    const { start, end } = weekBounds("2026-W47");
    expect(new Date(start).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(end - start).toBe(7 * 86_400_000);
    expect(previousWeek("2026-W47")).toBe("2026-W46");
    expect(previousWeek("2027-W01")).toBe("2026-W53");
  });
});

describe("season standings", () => {
  it("are the same however the entry list is ordered, and anyone gets the same digest", () => {
    const es = Array.from({ length: 9 }, (_, i) => entry(i));
    const a = seasonStandings("2026-W46", es);
    const b = seasonStandings("2026-W46", es.slice().reverse());
    expect(b).toEqual(a);
    expect(standingsDigest(a)).toBe(standingsDigest(b));
    expect(standingsDigest(seasonStandings("2026-W47", es))).not.toBe(standingsDigest(a));
  });

  it("score every pair from both sides: each entry fights 2(n-1) bouts and points add up", () => {
    const n = 7;
    const rows = seasonStandings("2026-W46", Array.from({ length: n }, (_, i) => entry(i)));
    for (const r of rows) expect(r.wins + r.draws + r.losses).toBe(2 * (n - 1));
    const draws = rows.reduce((t, r) => t + r.draws, 0);
    const wins = rows.reduce((t, r) => t + r.wins, 0);
    expect(wins).toBe(rows.reduce((t, r) => t + r.losses, 0));
    expect(rows.reduce((t, r) => t + r.points, 0)).toBe(3 * wins + draws);
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
  });

  it("level on points, the smaller brain ranks higher", () => {
    const twin = (i: number, lessons: unknown[]) => ({ ...entry(i, lessons), pet: { ...entry(i, lessons).pet, line: "gentle" as const } });
    // a lesson that never fires in a spar adds gates without changing a single move
    const idle = [{ when: { time: [0], owner: [1] }, then: { want: 1, mood: 0 } }];
    const small = twin(1, []);
    const big = twin(2, idle);
    expect(entryGates(big.pet)).toBeGreaterThan(entryGates(small.pet));
    const rows = seasonStandings("2026-W46", [big, small]);
    expect(rows[0]!.points).toBe(rows[1]!.points);
    expect(rows[0]!.key).toBe(small.key);
  });

  it("from week 2026-W48 (LX-SPAR/2) the smaller-brain tie-break is gone: level on points and wins, the order is fixed by key", () => {
    const twin = (i: number, lessons: unknown[]) => ({ ...entry(i, lessons), pet: { ...entry(i, lessons).pet, line: "gentle" as const } });
    // two pets that only ever rest draw every bout, in either version; one carries a lesson that never fires
    const rest = { when: {}, then: { want: 3, mood: 1 } };
    const idle = { when: { time: [0], owner: [1] }, then: { want: 1, mood: 0 } };
    const big = twin(1, [idle, rest]);
    const small = twin(2, [rest]);
    expect(entryGates(big.pet)).toBeGreaterThan(entryGates(small.pet));
    expect(seasonStandings("2026-W47", [big, small])[0]!.key).toBe(small.key);
    const rows = seasonStandings("2026-W48", [small, big]);
    expect(rows[0]!.points).toBe(rows[1]!.points);
    expect(rows[0]!.key).toBe(big.key);
  });

  it("a claimed age changes nothing", () => {
    const es = [entry(1, [], "baby"), entry(2)];
    const old = [entry(1, [], "elder"), entry(2)];
    expect(seasonStandings("2026-W46", es).map((r) => [r.key, r.points])).toEqual(seasonStandings("2026-W46", old).map((r) => [r.key, r.points]));
  });

  it("a full season of 64 entries is computed in reasonable time, and extra entries are ignored", () => {
    const es = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => entry(i));
    const t = performance.now();
    const rows = seasonStandings("2026-W46", es);
    expect(performance.now() - t).toBeLessThan(15_000);
    expect(rows).toHaveLength(MAX_ENTRIES);
  });

  it("places earn badge tiers", () => {
    expect([1, 2, 3, 4, 10, 11].map(placeTier)).toEqual([3, 2, 2, 1, 1, 0]);
  });
});
