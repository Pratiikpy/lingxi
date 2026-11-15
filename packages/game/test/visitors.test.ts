import { describe, expect, it } from "vitest";
import { VISITORS, addToAlbum, visitorOn, visitorsDuring } from "../src/visitors";
import { awayEvent } from "../src/away";
import { EVENT } from "../src/sim";

describe("the visitor album", () => {
  it("visitors are exactly the friend surprises of an absence, the same every time", () => {
    const seed = 123456;
    const v = visitorsDuring(seed, 1000, 1000 + 3 * 24 * 60);
    const friends = Array.from({ length: 3 * 24 * 60 }, (_, i) => 1001 + i).filter((b) => awayEvent(seed, b) === EVENT.friend);
    expect(v.map((x) => x.beat)).toEqual(friends);
    expect(visitorsDuring(seed, 1000, 1000 + 3 * 24 * 60)).toEqual(v);
  });

  it("over many absences every visitor turns up, rare ones least", () => {
    const tally: Record<string, number> = {};
    for (let b = 0; b < 200_000; b++) {
      const id = visitorOn(42, b).id;
      tally[id] = (tally[id] ?? 0) + 1;
    }
    for (const v of VISITORS) expect(tally[v.id], v.id).toBeGreaterThan(0);
    const avg = (r: string) => VISITORS.filter((v) => v.rarity === r).reduce((t, v) => t + tally[v.id]!, 0) / VISITORS.filter((v) => v.rarity === r).length;
    expect(avg("common")).toBeGreaterThan(avg("uncommon"));
    expect(avg("uncommon")).toBeGreaterThan(avg("rare"));
  });

  it("the album counts visits and keeps the first", () => {
    const a = VISITORS[0]!;
    let album = addToAlbum({}, [{ beat: 100, visitor: a }]);
    album = addToAlbum(album, [{ beat: 50, visitor: a }, { beat: 200, visitor: VISITORS[1]! }]);
    expect(album[a.id]).toEqual({ count: 2, first: 50 * 60_000 });
    expect(album[VISITORS[1]!.id]!.count).toBe(1);
  });

  it("every visitor has words in both languages and a distinct id", () => {
    expect(new Set(VISITORS.map((v) => v.id)).size).toBe(VISITORS.length);
    for (const v of VISITORS) expect(v.name.zh && v.note.zh && v.note.en).toBeTruthy();
  });
});
