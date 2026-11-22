import { describe, expect, it } from "vitest";
import { HOME, ITEM, MOVE_ENERGY, RECIPES, ROOMS, type WorldState, buy, claim, craft, forage, give, move, neighbours, newWorld, openBox, take } from "../src/world";
import { QUESTS, questState } from "../src/quests";

const T0 = Date.UTC(2026, 10, 16, 2);

describe("the map", () => {
  it("has 60+ rooms, every one with text in both languages and a day background", () => {
    const rooms = Object.values(ROOMS);
    expect(rooms.length).toBeGreaterThanOrEqual(60);
    for (const r of rooms) {
      expect(r.name.en && r.name.zh && r.desc.en && r.desc.zh).toBeTruthy();
      expect(r.bgs.day).toMatch(/^art\/rooms\//);
    }
  });
  it("every room can be reached from home", () => {
    const seen = new Set([HOME]);
    const queue = [HOME];
    while (queue.length) {
      for (const n of neighbours(queue.shift()!)) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
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
  it("every recipe works with exactly its inputs, tool, energy and room, and says what is missing otherwise (plan 4.5)", () => {
    expect(RECIPES.length).toBeGreaterThan(30);
    for (const r of RECIPES) {
      const name = r.name.en;
      // a world holding exactly the inputs and the tool, standing in the recipe's room
      let w: WorldState = { ...newWorld("s"), bag: {}, room: r.room ?? HOME };
      for (const x of r.ins) w = give(w, x.item, x.amount);
      if (r.tool !== undefined) w = give(w, r.tool, 1);
      const made = craft(w, r.index, r.energy);
      expect(made.ok, name).toBe(true);
      if (!made.ok) continue;
      expect(made.world.bag[r.out], name).toBe(r.outAmount);
      for (const x of r.ins) if (x.item !== r.out) expect(made.world.bag[x.item] ?? 0, `${name}: ${x.item} used up`).toBe(0);
      if (r.tool !== undefined) expect(made.world.bag[r.tool], `${name}: the tool stays`).toBe(1);
      expect([made.energy, made.xp]).toEqual([r.energy, r.xp]);
      // work costs energy, except the offering at the shrine (no stamina in the source either)
      if (r.room === undefined) expect(r.energy, name).toBeGreaterThan(0);
      // each missing piece is named
      if (r.tool !== undefined) expect(craft({ ...w, bag: { ...w.bag, [r.tool]: 0 } }, r.index, r.energy), name).toEqual({ ok: false, reason: "tool" });
      if (r.room !== undefined) expect(craft({ ...w, room: HOME }, r.index, r.energy), name).toEqual({ ok: false, reason: "room" });
      const first = r.ins[0]!;
      expect(craft({ ...w, bag: { ...w.bag, [first.item]: first.amount - 1 } }, r.index, r.energy), name).toEqual({ ok: false, reason: "missing" });
      if (r.energy > 0) expect(craft(w, r.index, r.energy - 1), name).toEqual({ ok: false, reason: "tired" });
    }
  });

  it("quest 37 says what the bench does: three pebbles make a stone block, no tool needed (G8, small batch beside the bulk)", () => {
    // G6 adds small batches from fossil too; quest 37's is the pebble one
    const small = RECIPES.filter((r) => r.out === 1301 && r.tool === undefined && r.room === undefined && r.ins.some((x) => x.item === 1002));
    expect(small.map((r) => r.ins)).toEqual([[{ item: 1002, amount: 3 }]]);
    let w: WorldState = { ...newWorld("s"), bag: {} };
    w = give(w, 1002, 3);
    const made = craft(w, small[0]!.index, small[0]!.energy);
    expect(made.ok && made.world.bag[1301]).toBe(1);
    // the source's bulk recipe is still there beside it
    expect(RECIPES.some((r) => r.out === 1301 && r.ins[0]!.amount === 100)).toBe(true);
  });

  it("keeps the source's own amounts: an extraction makes 500 and a brew uses hundreds (no more squashing to 3)", () => {
    const pollen = RECIPES.find((r) => r.out === 1104)!;
    expect(pollen.outAmount).toBe(500);
    const study = RECIPES.find((r) => r.out === 11401)!;
    expect(study.ins).toEqual([{ item: 1003, amount: 1 }, { item: 1104, amount: 1000 }]);
    expect([study.tool, study.energy, study.xp]).toEqual([23101, 60, 7]);
    // the room-only recipe: an old coin offered at the shrine
    const offer = RECIPES.find((r) => r.room !== undefined)!;
    expect([offer.index, offer.room, offer.out]).toEqual([10002, 11, 21007]);
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
    // a milestone of its own (no story quest does the same deed): playtime, after the first meal
    const fed = { ...newWorld("s"), quests: { active: {}, done: { q02: T0 } } };
    const playView = { ...view, counts: { ...view.counts, play: 5 } };
    const r = claim(fed, "playtime", playView);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.coins).toBe(fed.coins + 20);
    expect(claim(r.world, "playtime", playView).ok).toBe(false);
  });

  // B6: a milestone that repeats a story quest's deed pays nothing of its own: it is done when the story quest is
  it("a milestone that repeats a story quest is done with it, never paid twice", () => {
    const mirrored = QUESTS.filter((q) => q.story);
    expect(mirrored.map((q) => q.id).sort()).toEqual(["bath", "explorer", "firstLesson", "firstMeal", "hello", "maker"]);
    const w = newWorld("s");
    const hello = QUESTS.find((q) => q.id === "hello")!;
    expect(questState(hello, { ...view, world: w }, w.claimed), "the pats are given, but the story quest pays for them").toBe("active");
    expect(claim(w, "hello", view)).toEqual({ ok: false, reason: "notReady" });
    const told = { ...w, quests: { active: {}, done: { q01: T0 } } };
    expect(questState(hello, { ...view, world: told }, told.claimed)).toBe("claimed");
    // and what comes after it in the milestones opens as before
    expect(questState(QUESTS.find((q) => q.id === "bath")!, { ...view, world: told }, told.claimed)).not.toBe("locked");
  });
  it("every quest has text in both languages and a reachable predecessor", () => {
    const ids = new Set(QUESTS.map((q) => q.id));
    for (const q of QUESTS) {
      expect(q.title.zh && q.goal.zh && q.title.en && q.goal.en).toBeTruthy();
      if (q.after) expect(ids.has(q.after)).toBe(true);
    }
  });
});
