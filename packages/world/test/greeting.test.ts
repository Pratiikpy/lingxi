import { describe, expect, it } from "vitest";
import { scanNames } from "../src/names";
import {
  CHARACTERS,
  FOLK,
  FOLK_BY_ID,
  FRIEND_BY_ID,
  type WorldState,
  folkViewOf,
  giveGift,
  greetingNow,
  newWorld,
} from "../src";

const withItem = (w: WorldState, item: number, n: number): WorldState => ({
  ...w,
  bag: { ...w.bag, [item]: (w.bag[item] ?? 0) + n },
});
const at = (
  o: Partial<{ hour: number; day: string; petHappy: boolean; petHungry: boolean; questReady: boolean }> = {},
) => ({
  hour: 14,
  day: "2026-11-16",
  petHappy: false,
  petHungry: false,
  questReady: false,
  ...o,
});

describe("residents greet you through their circuits (plan 4.11)", () => {
  it("every resident has seven lines for the moment, in both languages, and four faces", () => {
    expect(FOLK.map((f) => f.id).sort()).toEqual(CHARACTERS.map((c) => c.id).sort());
    for (const f of FOLK) {
      for (const slot of [1, 2, 3, 4, 5, 6, 7] as const) {
        const l = f.lines[slot];
        expect(l.en.length * l.zh.length, `${f.id} ${slot}`).toBeGreaterThan(0);
        expect(scanNames(`${l.en}\n${l.zh}`), `${f.id} ${slot}`).toEqual([]);
      }
      expect(f.faces).toHaveLength(4);
    }
  });

  it("an ordinary afternoon gives their usual hello, with the face of their mood", () => {
    const w = newWorld("g");
    for (const c of CHARACTERS) {
      const g = greetingNow(c.id, folkViewOf(w, c.id, at()))!;
      expect(g.slot, c.id).toBe(0);
      expect(g.lines.map((l) => l.en)).toEqual(c.greeting.map((l) => l.en));
      expect(g.lines[0]!.face).toBe(FOLK_BY_ID[c.id]!.faces[g.mood]);
    }
  });

  it("a refused gift today is remembered, and Bolt's greeting says so; tomorrow it is forgotten", () => {
    const bolt = FRIEND_BY_ID.bolt!;
    const r = giveGift(withItem(newWorld("g"), 21201, 1), bolt, 21201, "2026-11-16");
    if (!r.ok) throw new Error(r.reason);
    expect(r.trust).toBe(0);
    expect(r.world.friends?.lastGift?.bolt).toEqual({ day: "2026-11-16", taste: "dislike" });
    const today = greetingNow("bolt", folkViewOf(r.world, "bolt", at()))!;
    expect([today.slot, today.lines[0]!.en]).toEqual([4, FOLK_BY_ID.bolt!.lines[4].en]);
    expect(greetingNow("bolt", folkViewOf(r.world, "bolt", at({ day: "2026-11-17" })))!.slot).toBe(0);
  });

  it("the time of day, trust, a hungry pet and a finished errand each change what they say", () => {
    const w = newWorld("g");
    expect(greetingNow("flit", folkViewOf(w, "flit", at({ hour: 8 })))!.slot).toBe(1);
    expect(greetingNow("twain", folkViewOf(w, "twain", at({ hour: 23 })))!.slot).toBe(2);
    expect(greetingNow("yonder", folkViewOf(w, "yonder", at({ petHungry: true })))!.slot).toBe(6);
    expect(greetingNow("praline", folkViewOf(w, "praline", at({ questReady: true })))!.slot).toBe(7);
    const trusted: WorldState = { ...w, trust: { wick: 30 } };
    expect(greetingNow("wick", folkViewOf(trusted, "wick", at()))!.slot).toBe(5);
  });
});
