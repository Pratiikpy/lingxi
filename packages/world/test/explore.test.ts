import { describe, expect, it } from "vitest";
import { DESTINATIONS, type ExploreMods, NO_EXPLORE_MODS, ROOMS, endTrip, endWalk, forage, move, neighbours, newWorld, startTrip, startWalk } from "../src";

/** Explore skills (plan 4.4): the world applies the numbers the game builds from a pet's skills. */
const mods = (m: Partial<ExploreMods>): ExploreMods => ({ ...NO_EXPLORE_MODS, ...m });
const T = Date.UTC(2026, 10, 20, 0, 0, 0);

describe("Explore skills in the world's rules", () => {
  it("leave every number as it was for a pet with no skills", () => {
    expect(NO_EXPLORE_MODS).toEqual({ moveEnergy: 15, forageEnergy: 10, extraFind: 0, rareBoost: 0, forageWaitOff: 0, walksWithFinds: 0, stepsOff: 0, visitCoins: 0, tripExtra: 0 });
  });

  it("Light Feet: a tired pet can still walk when the move costs less; Wanderer pays more for a new room", () => {
    const w = newWorld("move");
    const to = neighbours(w.room)[0]!;
    expect(move(w, to, 10)).toEqual({ ok: false, reason: "tired" });
    const r = move(w, to, 10, mods({ moveEnergy: 5, visitCoins: 10 }));
    expect(r.ok && r.coins).toBe(15);
  });

  it("Sharp Eyes: looking around costs less; Explorer's Map: a room can be looked around again sooner", () => {
    const room = Object.values(ROOMS).find((r) => r.drops.length)!;
    const w = { ...newWorld("look"), room: room.index };
    expect(forage(w, T, 5)).toEqual({ ok: false, reason: "tired" });
    expect(forage(w, T, 5, mods({ forageEnergy: 2 })).ok).toBe(true);
    const plain = forage(w, T, 100);
    const map = forage(w, T, 100, mods({ forageWaitOff: 30 }));
    if (!plain.ok || !map.ok) throw new Error("forage");
    expect(forage(plain.world, T + 40 * 60_000, 100)).toEqual({ ok: false, reason: "already" });
    expect(forage(map.world, T + 40 * 60_000, 100, mods({ forageWaitOff: 30 })).ok).toBe(true);
  });

  it("Lucky Paws: second finds come more often; Dowser: rare finds (tiers 1 to 4) come more often", () => {
    const room = Object.values(ROOMS).find((r) => r.drops.length > 3 && r.drops.some((d) => d.tier <= 4) && r.drops.some((d) => d.tier > 4))!;
    const rare = new Set(room.drops.filter((d) => d.tier <= 4).map((d) => d.item));
    const tally = (m = NO_EXPLORE_MODS) => {
      let seconds = 0;
      let rares = 0;
      for (let h = 0; h < 3000; h++) {
        const r = forage({ ...newWorld("luck"), room: room.index }, T + h * 3_600_000, 100, m);
        if (!r.ok) continue;
        if (r.found.reduce((a, f) => a + f.n, 0) > 1) seconds++;
        rares += r.found.filter((f) => rare.has(f.item)).reduce((a, f) => a + f.n, 0);
      }
      return { seconds, rares };
    };
    const plain = tally();
    expect(plain.seconds / 3000).toBeGreaterThan(0.28);
    expect(plain.seconds / 3000).toBeLessThan(0.39);
    expect(tally(mods({ extraFind: 25 })).seconds / 3000).toBeGreaterThan(0.53);
    expect(tally(mods({ rareBoost: 80 })).rares).toBeGreaterThan(plain.rares * 1.4);
  });

  it("Second Wind: one more walk a day brings finds; Strider: finds come at fewer steps", () => {
    let w = newWorld("walk");
    const walk = (world: typeof w, at: number, m = NO_EXPLORE_MODS) => {
      const s = startWalk(world, at, false);
      if (!s.ok) throw new Error("start");
      const e = endWalk(s.world, at + 20 * 60_000, m);
      if (!e.ok) throw new Error("end");
      return e;
    };
    // two walks with finds a day, then the third finds nothing
    for (let k = 0; k < 2; k++) w = walk(w, T + k * 3_600_000).world;
    expect(walk(w, T + 3 * 3_600_000).finds).toEqual([]);
    expect(walk(w, T + 3 * 3_600_000, mods({ walksWithFinds: 1 })).finds.length).toBeGreaterThan(0);
    const count = (m = NO_EXPLORE_MODS) => walk(newWorld("walk"), T, m).finds.reduce((a, f) => a + f.n, 0);
    expect(count(mods({ stepsOff: 100 }))).toBeGreaterThan(count());
  });

  it("Pathfinder: a percent chance of one more find on a trip", () => {
    let more = 0;
    let base = 0;
    for (let k = 0; k < 200; k++) {
      const s = startTrip(newWorld(`trip${k}`), DESTINATIONS[0]!.id, T);
      if (!s.ok) throw new Error(s.reason);
      const n = (m = NO_EXPLORE_MODS) => {
        const e = endTrip(s.world, T + 48 * 3_600_000, m);
        if (!e.ok) throw new Error(e.reason);
        return e.found.reduce((a, f) => a + f.n, 0);
      };
      base += n();
      more += n(mods({ tripExtra: 50 }));
    }
    expect(more - base).toBeGreaterThan(70);
    expect(more - base).toBeLessThan(130);
  });
});
