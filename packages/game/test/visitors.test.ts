import { describe, expect, it } from "vitest";
import { VISITORS, addToAlbum, visitorOn, visitorsDuring } from "../src/visitors";
import { awayEvent } from "../src/away";
import { EVENT } from "../src/sim";

describe("the visitor album", () => {
  it("visitors are exactly the friend surprises of an absence, the same every time", () => {
    const seed = 123456;
    const v = visitorsDuring(seed, 1000, 1000 + 3 * 24 * 60);
    const friends = Array.from({ length: 3 * 24 * 60 }, (_, i) => 1001 + i).filter(
      (b) => awayEvent(seed, b) === EVENT.friend,
    );
    expect(v.map((x) => x.beat)).toEqual(friends);
    expect(visitorsDuring(seed, 1000, 1000 + 3 * 24 * 60)).toEqual(v);
  });

  it("over many absences every visitor who comes to anyone turns up, rare ones least", () => {
    const tally: Record<string, number> = {};
    for (let b = 0; b < 200_000; b++) {
      const id = visitorOn(42, b).id;
      tally[id] = (tally[id] ?? 0) + 1;
    }
    // with nothing known about the pet, those who come to anyone (G4 adds visitors who need something)
    const anyone = VISITORS.filter((v) => !v.need);
    for (const v of anyone) expect(tally[v.id], v.id).toBeGreaterThan(0);
    const avg = (r: string) =>
      anyone.filter((v) => v.rarity === r).reduce((t, v) => t + tally[v.id]!, 0) /
      anyone.filter((v) => v.rarity === r).length;
    expect(avg("common")).toBeGreaterThan(avg("uncommon"));
    expect(avg("uncommon")).toBeGreaterThan(avg("rare"));
  });

  it("the album counts visits and keeps the first", () => {
    const a = VISITORS[0]!;
    let album = addToAlbum({}, [{ beat: 100, visitor: a }]);
    album = addToAlbum(album, [
      { beat: 50, visitor: a },
      { beat: 200, visitor: VISITORS[1]! },
    ]);
    expect(album[a.id]).toEqual({ count: 2, first: 50 * 60_000 });
    expect(album[VISITORS[1]!.id]!.count).toBe(1);
  });

  it("every visitor has words in both languages and a distinct id", () => {
    expect(new Set(VISITORS.map((v) => v.id)).size).toBe(VISITORS.length);
    for (const v of VISITORS) expect(v.name.zh && v.note.zh && v.note.en).toBeTruthy();
  });
});

describe("what visitors say about themselves is true (D11)", () => {
  it("Moonwalker comes only at the pet's own night, and its hint says so", async () => {
    const { VISITORS, visitorComes, visitorHint } = await import("../src/visitors");
    const moon = VISITORS.find((v) => v.id === "moonwalker")!;
    const ctx = (tz: number) => ({
      lessons: [],
      traits: {} as never,
      line: "gentle" as const,
      stage: "adult" as const,
      tzOffsetMin: tz,
    });
    const at = (h: number) => Date.UTC(2026, 10, 24, h, 30);
    // UTC+8: 14:30 UTC is 22:30 there (night), 04:30 UTC is 12:30 there (day)
    expect(visitorComes(moon, ctx(480), at(14))).toBe(true);
    expect(visitorComes(moon, ctx(480), at(4))).toBe(false);
    // the same moments for a pet in UTC: day at 14:30, night at 04:30
    expect(visitorComes(moon, ctx(0), at(14))).toBe(false);
    expect(visitorComes(moon, ctx(0), at(4))).toBe(true);
    const names = { trait: String, line: String, stage: String, form: String, season: String } as never;
    expect(visitorHint(moon, "en", names)).toContain("night");
    expect(visitorHint(moon, "zh", names)).toContain("夜里");
  });

  it("the seasonal game follows the world's season, the one the home screen names", async () => {
    const { gameSeasonAt } = await import("../src/games");
    const { WORLD_SEASONS, worldSeasonAt } = await import("../src/worldSeason");
    const want = { blossom: "spring", lantern: "summer", harvest: "autumn", frost: "winter" } as const;
    for (let d = 0; d < 120; d += 3) {
      const ms = Date.UTC(2026, 10, 16) + d * 86_400_000;
      expect(gameSeasonAt(ms)).toBe(want[worldSeasonAt(ms).id]);
    }
    expect(WORLD_SEASONS).toHaveLength(4);
    // late November is Blossom Weeks in the world, so the game is spring, not the calendar's autumn
    expect(gameSeasonAt(Date.UTC(2026, 10, 23, 12))).toBe(want[worldSeasonAt(Date.UTC(2026, 10, 23, 12)).id]);
  });
});
