import { describe, expect, it } from "vitest";
import { HOME, ITEM, MOVE_ENERGY, RECIPES, ROOMS, buy, claim, craft, forage, give, move, neighbours, newWorld, openBox, take } from "../src/world";
import { QUESTS, questState } from "../src/quests";

const T0 = Date.UTC(2026, 10, 16, 2);

describe("the map", () => {
  it("has 60+ rooms, every one with text in both languages and a day background", () => {
    const rooms = Object.values(ROOMS);
    expect(rooms.length).toBeGreaterThanOrEqual(60);
    for (const r of rooms) {
      expect(r.name.en && r.name.zh && r.desc.en && r.desc.zh).toBeTruthy();
      expect(r.bgs.day).toMatch(/^pet\/rooms\//);
    }
  });
  it("every room can be reached from home", () => {
    const seen = new Set([HOME]);
    const queue = [HOME];
    while (queue.length) for (const n of neighbours(queue.shift()!)) if (!seen.has(n)) (seen.add(n), queue.push(n));
    const unreachable = Object.keys(ROOMS).map(Number).filter((r) => !seen.has(r));
    expect(unreachable).toEqual([]);
  });
  it("neighbours are symmetric", () => {
    for (const r of Object.keys(ROOMS).map(Number)) for (const n of neighbours(r)) expect(neighbours(n)).toContain(r);
  });
});

describe("walking and finding", () => {
  it("moves only to neighbours, pays first-visit coins once, needs energy", () => {
    const w = newWorld("s");
    const n = neighbours(HOME)[0]!;
    expect(move(w, 1, 900).ok).toBe(false);
    expect(move(w, n, MOVE_ENERGY - 1).ok).toBe(false);
    const a = move(w, n, 900);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.firstVisit).toBe(true);
    expect(a.world.coins).toBe(w.coins + 5);
    const back = move(a.world, HOME, 900);
    if (!back.ok) throw new Error();
    const again = move(back.world, n, 900);
    if (!again.ok) throw new Error();
    expect(again.coins).toBe(0);
  });
  it("forage is deterministic per hour and once per room per hour", () => {
    let w = newWorld("seed-1");
    const room = Object.values(ROOMS).find((r) => r.drops.length && r.index !== HOME)!;
    w = { ...w, room: room.index };
    const a = forage(w, T0, 900);
    const b = forage(w, T0 + 1000, 900);
    expect(a).toEqual(b);
    if (!a.ok) throw new Error(a.reason);
    expect(a.found.length).toBeGreaterThan(0);
    expect(forage(a.world, T0 + 5000, 900).ok).toBe(false);
    expect(forage(a.world, T0 + 3_600_000, 900).ok).toBe(true);
  });
});

describe("shop, workbench, bag", () => {
  it("buys only what this room sells, with enough coins", () => {
    const w = { ...newWorld("s"), room: 13 };
    const item = ROOMS[13]!.shop[0]!;
    const r = buy(w, item);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.world.coins).toBe(w.coins - ITEM[item]!.price!);
    expect(buy({ ...w, room: HOME }, item).ok).toBe(false);
    expect(buy({ ...w, coins: 0 }, item).ok).toBe(false);
  });
  it("every recipe can be made from ingredients that exist in Lingxi", () => {
    expect(RECIPES.length).toBeGreaterThan(20);
    for (const r of RECIPES) {
      let w = newWorld("s");
      for (const x of r.ins) w = give(w, x.item, x.amount);
      const made = craft(w, r.index);
      expect(made.ok, r.name.en).toBe(true);
      if (made.ok) expect(made.world.bag[r.out]).toBeGreaterThanOrEqual(r.outAmount);
    }
  });
  it("taking food gives its effect and removes it", () => {
    const w = newWorld("s");
    const r = take(w, 11130);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.use.food).toBeGreaterThan(0);
      expect(r.world.bag[11130]).toBe(2);
    }
    expect(take(w, 1001).ok).toBe(false);
  });
  it("a river box gives two or three things", () => {
    const w = give(newWorld("s"), 21007, 1);
    const r = openBox(w, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const n = r.found.reduce((s, f) => s + f.n, 0);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(r.world.bag[21007]).toBeUndefined();
    }
  });
});

describe("quests", () => {
  const view = { counts: { feed: 0, play: 0, clean: 0, pet: 3, lessons: 0 }, stage: "baby", onChain: false };
  it("unlock in order and pay out once", () => {
    const w = newWorld("s");
    expect(questState(QUESTS.find((q) => q.id === "bath")!, { ...view, world: w }, w.claimed)).toBe("locked");
    const r = claim(w, "hello", view);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.coins).toBe(w.coins + 10);
    expect(claim(r.world, "hello", view).ok).toBe(false);
    expect(questState(QUESTS.find((q) => q.id === "bath")!, { ...view, world: r.world }, r.world.claimed)).toBe("active");
  });
  it("every quest has text in both languages and a reachable predecessor", () => {
    const ids = new Set(QUESTS.map((q) => q.id));
    for (const q of QUESTS) {
      expect(q.title.zh && q.goal.zh && q.title.en && q.goal.en).toBeTruthy();
      if (q.after) expect(ids.has(q.after)).toBe(true);
    }
  });
});
