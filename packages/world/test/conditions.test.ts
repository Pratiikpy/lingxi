import { describe, expect, it } from "vitest";
import {
  type Condition,
  type ConditionView,
  CHARACTERS,
  CROPS,
  DESTINATIONS,
  GARDEN_ROOM,
  HOME,
  ITEM,
  LEFT_OUT,
  RECIPES,
  ROOMS,
  TYPES,
  WALK_MINUTES,
  type WorldState,
  assertSheet,
  backfillTally,
  buy,
  buyDecor,
  buyPiece,
  checkAll,
  conditionErrors,
  craft,
  endTrip,
  endWalk,
  forage,
  giveTo,
  harvest,
  make,
  move,
  neighbours,
  newWorld,
  openBox,
  plant,
  progressOf,
  snapshotOf,
  startTrip,
  startWalk,
  tallyOf,
  take,
  bump,
  withFlag,
  SHEETS,
  checkSheets,
} from "../src";

const T0 = Date.UTC(2026, 10, 16, 9);
const MIN = 60_000;
const ok = <T,>(r: ({ ok: true; world: WorldState } & T) | { ok: false; reason: string }) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const view = (world: WorldState, over: Partial<ConditionView> = {}): ConditionView => ({
  world,
  pet: { level: 4, stage: "teen", onChain: true },
  pets: 2,
  now: T0,
  timeOfDay: 2,
  bondLevel: 0,
  goalsDone: [],
  ...over,
});
const c = (type: Condition["type"], logic: Condition["logic"], index?: number | string, value?: number): Condition => ({
  type,
  logic,
  ...(index !== undefined ? { index } : {}),
  ...(value !== undefined ? { value } : {}),
});

describe("the condition engine", () => {
  it("maps every one of the source's objective types but the two left out on purpose", () => {
    // note A §8.3: 24 rows, of which gacha rerolls and the launch flag are left out
    const sourceTypes = [
      "ITEM_BURN", "HARVEST_TIME", "HARVEST_TIME_MOONSIDE", "SCAV_CLAIM_NODE", "DROPTABLE_ITEM_TOTAL", "CRAFT_ITEM", "ROOM", "MOVE",
      "LISTING_BUY_TOTAL", "ITEM_SPEND", "ITEM_TOTAL", "PET_NUM_OWNED", "PET_LEVELS_TOTAL", "PET_LEVEL_HIGHEST", "SKILL_POINTS_USE",
      "PET_NAME", "PET_ITEM_USE", "LIQUIDATE_TOTAL", "TRADE_EXECUTE", "PHASE", "QUEST", "QUEST_COMPLETED_DELAY", "BLOCKTIME",
      "REPUTATION", "COMPLETE_COMP",
    ];
    const mapped = new Set<string | undefined>(Object.values(TYPES).map((s) => ("source" in s ? s.source : undefined)).filter(Boolean));
    for (const s of sourceTypes) expect(mapped, s).toContain(s);
    for (const s of LEFT_OUT) expect(mapped.has(s)).toBe(false);
  });

  it("each mapped type reads the right value", () => {
    let w: WorldState = { ...newWorld("seed-cond"), room: 13, coins: 77, visited: [65, 13, 14], bag: { 11130: 5 }, flags: ["named"] };
    w = bump(bump(bump(w, "GIVE", 11130, 3), "GIVE_TO", "praline", 2), "GIVE_TO", "praline:11130", 2, { total: false });
    for (const [type, index, n] of [
      ["TOGETHER", 13, 40], ["TOGETHER_NIGHT", 0, 25], ["FORAGE", 13, 6], ["FIND", 11130, 9], ["CRAFT", 11313, 2], ["MOVE", 0, 11],
      ["BUY", 11130, 4], ["COINS_SPENT", 0, 120], ["COINS_EARNED", 0, 300], ["USE", 11130, 7], ["LESSON", 0, 5], ["SPAR_WIN", 0, 3],
      ["GIFT", 0, 8], ["SAVE", 0, 12], ["CARE", "feed", 21], ["CHOOSE", "share", 2],
    ] as const) w = bump(w, type, index, n);
    w = { ...w, quests: { active: {}, done: { hello: T0 - 2 * 86_400_000 } }, trust: { praline: 14 } };
    const v = view(w, { goalsDone: ["lanterns"], bondLevel: 3, timeOfDay: 0 });
    const read = (cond: Condition) => progressOf(cond, v).have;
    expect(read(c("GIVE", "CURR_MIN", 11130, 1))).toBe(3); // ITEM_BURN
    expect(read(c("GIVE_TO", "CURR_MIN", "praline", 1))).toBe(2);
    expect(read(c("GIVE_TO", "CURR_MIN", "praline:11130", 1))).toBe(2);
    expect(read(c("GIVE_TO", "CURR_MIN", "bolt", 1))).toBe(0);
    expect(read(c("TOGETHER", "CURR_MIN", 13, 1))).toBe(40); // HARVEST_TIME
    expect(read(c("TOGETHER_NIGHT", "CURR_MIN", undefined, 1))).toBe(25); // HARVEST_TIME_MOONSIDE
    expect(read(c("FORAGE", "CURR_MIN", 13, 1))).toBe(6); // SCAV_CLAIM_NODE
    expect(read(c("FIND", "CURR_MIN", 11130, 1))).toBe(9); // DROPTABLE_ITEM_TOTAL
    expect(read(c("CRAFT", "CURR_MIN", 11313, 1))).toBe(2); // CRAFT_ITEM
    expect(progressOf(c("ROOM", "BOOL_IS", 13), v).met).toBe(true); // ROOM
    expect(progressOf(c("ROOM", "BOOL_IS", HOME), v).met).toBe(false);
    expect(read(c("MOVE", "CURR_MIN", undefined, 1))).toBe(11); // MOVE
    expect(read(c("BUY", "CURR_MIN", 11130, 1))).toBe(4); // LISTING_BUY_TOTAL
    expect(read(c("COINS_SPENT", "CURR_MIN", undefined, 1))).toBe(120); // ITEM_SPEND
    expect(read(c("COINS_EARNED", "CURR_MIN", undefined, 1))).toBe(300); // ITEM_TOTAL
    expect(read(c("PETS", "CURR_MIN", undefined, 1))).toBe(2); // PET_NUM_OWNED
    expect(read(c("LEVEL", "CURR_MIN", undefined, 1))).toBe(4); // PET_LEVEL_HIGHEST
    expect(read(c("STAGE", "CURR_MIN", undefined, 1))).toBe(2); // PET_LEVELS_TOTAL: teen is the third stage
    expect(read(c("LESSON", "CURR_MIN", undefined, 1))).toBe(5); // SKILL_POINTS_USE
    expect(progressOf(c("FLAG", "BOOL_IS", "named"), v).met).toBe(true); // PET_NAME
    expect(read(c("USE", "CURR_MIN", 11130, 1))).toBe(7); // PET_ITEM_USE
    expect(read(c("SPAR_WIN", "CURR_MIN", undefined, 1))).toBe(3); // LIQUIDATE_TOTAL
    expect(read(c("GIFT", "CURR_MIN", undefined, 1))).toBe(8); // TRADE_EXECUTE
    expect(progressOf(c("TIME_OF_DAY", "BOOL_IS", "night"), v).met).toBe(true); // PHASE
    expect(progressOf(c("TIME_OF_DAY", "BOOL_IS", "day"), v).met).toBe(false);
    expect(progressOf(c("QUEST", "BOOL_IS", "hello"), v).met).toBe(true); // QUEST
    expect(progressOf(c("QUEST", "BOOL_NOT", "bath"), v).met).toBe(true);
    expect(progressOf(c("QUEST_DELAY", "BOOL_IS", "hello", 86_400), v).met).toBe(true); // QUEST_COMPLETED_DELAY
    expect(progressOf(c("QUEST_DELAY", "BOOL_IS", "hello", 3 * 86_400), v).met).toBe(false);
    expect(progressOf(c("NOW", "CURR_MIN", undefined, T0 - 1), v).met).toBe(true); // BLOCKTIME
    expect(progressOf(c("NOW", "CURR_MAX", undefined, T0 - 1), v).met).toBe(false);
    expect(read(c("TRUST", "CURR_MIN", "praline", 1))).toBe(14); // REPUTATION
    expect(progressOf(c("GOAL_DONE", "BOOL_IS", "lanterns"), v).met).toBe(true); // COMPLETE_COMP
    // Lingxi's own
    expect(read(c("ITEM", "CURR_MIN", 11130, 1))).toBe(5);
    expect(read(c("COINS", "CURR_MIN", undefined, 1))).toBe(77);
    expect(read(c("VISITED", "CURR_MIN", undefined, 1))).toBe(3);
    expect(read(c("SAVE", "CURR_MIN", undefined, 1))).toBe(12);
    expect(read(c("CARE", "CURR_MIN", "feed", 1))).toBe(21);
    expect(read(c("CHOOSE", "CURR_MIN", "share", 1))).toBe(2);
    expect(read(c("BOND", "CURR_MIN", undefined, 1))).toBe(3);
    expect(progressOf(c("ON_CHAIN", "BOOL_IS"), v).met).toBe(true);
    expect(progressOf(c("ON_CHAIN", "BOOL_IS"), view(w, { pet: null })).met).toBe(false);
  });

  it("MIN, MAX and EQUAL compare as the source does; a list needs every condition; an empty list passes", () => {
    const v = view({ ...newWorld("s"), coins: 10 });
    expect(progressOf(c("COINS", "CURR_MIN", undefined, 10), v).met).toBe(true);
    expect(progressOf(c("COINS", "CURR_MIN", undefined, 11), v).met).toBe(false);
    expect(progressOf(c("COINS", "CURR_MAX", undefined, 10), v).met).toBe(true);
    expect(progressOf(c("COINS", "CURR_MAX", undefined, 9), v).met).toBe(false);
    expect(progressOf(c("COINS", "CURR_EQUAL", undefined, 10), v).met).toBe(true);
    expect(checkAll([], v)).toBe(true);
    expect(checkAll([c("COINS", "CURR_MIN", undefined, 5), c("ROOM", "BOOL_IS", HOME)], v)).toBe(true);
    expect(checkAll([c("COINS", "CURR_MIN", undefined, 5), c("ROOM", "BOOL_NOT", HOME)], v)).toBe(false);
  });

  it("an INC objective counts only what happens after it is accepted", () => {
    let w = bump(newWorld("s"), "CARE", "feed", 30); // 30 feeds long before the quest
    const objectives = [c("CARE", "INC_MIN", "feed", 3)];
    const snap = snapshotOf(objectives, view(w));
    expect(snap).toEqual({ "CARE:feed": 30 });
    expect(checkAll(objectives, view(w), snap)).toBe(false);
    w = bump(w, "CARE", "feed", 2);
    expect(progressOf(objectives[0]!, view(w), snap)).toEqual({ have: 2, need: 3, met: false });
    w = bump(w, "CARE", "feed", 1);
    expect(progressOf(objectives[0]!, view(w), snap)).toEqual({ have: 3, need: 3, met: true });
    // the same objective read lifetime-long would have passed at once
    expect(progressOf(c("CARE", "CURR_MIN", "feed", 3), view(w)).met).toBe(true);
  });

  it("INC works on any count, not only the tally, and a fall never counts as progress", () => {
    let w: WorldState = { ...newWorld("s"), bag: { 11130: 4 } };
    const hold = [c("ITEM", "INC_MIN", 11130, 2)];
    const snap = snapshotOf(hold, view(w));
    w = { ...w, bag: { 11130: 1 } };
    expect(progressOf(hold[0]!, view(w), snap)).toEqual({ have: 0, need: 2, met: false });
    w = { ...w, bag: { 11130: 6 } };
    expect(progressOf(hold[0]!, view(w), snap).met).toBe(true);
  });

  it("an INC objective without a snapshot never passes (the source would complete it at once)", () => {
    const w = bump(newWorld("s"), "MOVE", 0, 50);
    expect(progressOf(c("MOVE", "INC_MIN", undefined, 1), view(w), {})).toEqual({ have: 0, need: 1, met: false });
  });
});

describe("every action bumps its counter", () => {
  const w0 = (): WorldState => ({ ...newWorld("seedseedseedseed"), coins: 500 });

  it("moving, and the coins a first visit pays", () => {
    const to = neighbours(HOME)[0]!;
    const r = ok(move(w0(), to, 900));
    expect(tallyOf(r.world, "MOVE")).toBe(1);
    expect(tallyOf(r.world, "COINS_EARNED")).toBe(r.coins);
  });

  it("looking around: the room and each thing found", () => {
    const room = Object.values(ROOMS).find((x) => x.drops.length && x.index !== HOME)!;
    const r = ok(forage({ ...w0(), room: room.index }, T0, 900));
    expect(tallyOf(r.world, "FORAGE", room.index)).toBe(1);
    expect(tallyOf(r.world, "FORAGE")).toBe(1);
    for (const f of r.found) expect(tallyOf(r.world, "FIND", f.item)).toBe(f.n);
    expect(tallyOf(r.world, "FIND")).toBe(r.found.reduce((t, f) => t + f.n, 0));
  });

  it("buying, the workbench, using an item and the river box", () => {
    const item = ROOMS[13]!.shop[0]!;
    const b = ok(buy({ ...w0(), room: 13 }, item));
    expect(tallyOf(b.world, "BUY", item)).toBe(1);
    expect(tallyOf(b.world, "COINS_SPENT")).toBe(ITEM[item]!.price);
    const recipe = RECIPES[0]!;
    const bag = Object.fromEntries(recipe.ins.map((x) => [x.item, x.amount]));
    const m = ok(craft({ ...w0(), bag }, recipe.index));
    expect(tallyOf(m.world, "CRAFT", recipe.out)).toBe(1);
    const u = ok(take(w0(), 11130));
    expect(tallyOf(u.world, "USE", 11130)).toBe(1);
    const box = ok(openBox({ ...w0(), bag: { 21007: 1 } }, T0));
    expect(tallyOf(box.world, "FIND")).toBe(box.found.reduce((t, f) => t + f.n, 0));
  });

  it("walks, trips and the garden", () => {
    const walked = ok(endWalk(ok(startWalk(w0(), T0, false)).world, T0 + WALK_MINUTES * MIN));
    expect(tallyOf(walked.world, "WALK")).toBe(1);
    expect(tallyOf(walked.world, "FIND")).toBe(walked.finds.reduce((t, f) => t + f.n, 0));
    const d = DESTINATIONS[0]!;
    const trip = ok(endTrip(ok(startTrip(w0(), d.id, T0)).world, T0 + d.hours * 3_600_000));
    expect(tallyOf(trip.world, "TRIP", d.id)).toBe(1);
    expect(tallyOf(trip.world, "FIND")).toBe(trip.found.reduce((t, f) => t + f.n, 0));
    const crop = CROPS.find((x) => x.id === "rice")!;
    const planted = ok(plant({ ...w0(), room: GARDEN_ROOM, bag: { [crop.seed]: 1 } }, 0, "rice", false, 0)).world;
    const h = ok(harvest(planted, 0, crop.hours * 3_600_000));
    expect(tallyOf(h.world, "HARVEST", "rice")).toBe(1);
    expect(tallyOf(h.world, "FIND", crop.yields)).toBe(h.n);
  });

  it("making outfits and decorations, and the Corner Shop and decor shop", () => {
    const w = { ...w0(), bag: { 1016: 2, 1001: 1, 1013: 2, 1002: 2 } };
    const m = ok(make(w, "outfit", "sunhat"));
    expect(tallyOf(m.world, "MAKE", "sunhat")).toBe(1);
    expect(tallyOf(m.world, "CRAFT")).toBe(1);
    const f = ok(make(m.world, "furniture", "mushroom"));
    expect(tallyOf(f.world, "MAKE", "mushroom")).toBe(1);
    expect(tallyOf(f.world, "CRAFT")).toBe(2);
    const p = ok(buyPiece({ ...w0(), room: 4 }, "hearts"));
    expect(tallyOf(p.world, "COINS_SPENT")).toBeGreaterThan(0);
    const dec = ok(buyDecor(w0(), "fern"));
    expect(tallyOf(dec.world, "BUY")).toBe(1);
  });

  it("giving to a resident: by item, by resident, and both; the items leave the bag", () => {
    const w = { ...w0(), bag: { 11130: 5 } };
    const r = ok(giveTo(w, "praline", 11130, 3));
    expect(r.world.bag[11130]).toBe(2);
    expect(tallyOf(r.world, "GIVE", 11130)).toBe(3);
    expect(tallyOf(r.world, "GIVE_TO", "praline")).toBe(3);
    expect(tallyOf(r.world, "GIVE_TO", "praline:11130")).toBe(3);
    expect(tallyOf(r.world, "GIVE_TO")).toBe(3); // counted once in the total
    expect(ok(giveTo(r.world, "praline", 11130, 2)).world.bag[11130]).toBeUndefined();
    expect(giveTo(w, "nobody", 11130)).toEqual({ ok: false, reason: "noResident" });
    expect(giveTo(w, "praline", 11130, 6)).toEqual({ ok: false, reason: "missing" });
    expect(giveTo(w, "praline", 11130, 0)).toEqual({ ok: false, reason: "badAmount" });
    expect(giveTo(w, "praline", 999_999)).toEqual({ ok: false, reason: "noItem" });
  });
});

describe("sheets are checked before they ship", () => {
  it("a sound condition has no errors", () => {
    expect(conditionErrors(c("GIVE_TO", "INC_MIN", "praline:11130", 3))).toEqual([]);
    expect(conditionErrors(c("FIND", "INC_MIN", undefined, 3))).toEqual([]);
    expect(conditionErrors(c("ROOM", "BOOL_IS", 13))).toEqual([]);
  });

  it("each kind of mistake is named", () => {
    expect(conditionErrors({ type: "NOPE" as Condition["type"], logic: "CURR_MIN", value: 1 })).toEqual(["unknown type NOPE"]);
    expect(conditionErrors({ type: "MOVE", logic: "CURR_MOST" as Condition["logic"], value: 1 })).toEqual(["unknown logic CURR_MOST"]);
    expect(conditionErrors(c("ROOM", "CURR_MIN", 13, 1))[0]).toMatch(/yes\/no/);
    expect(conditionErrors(c("MOVE", "BOOL_IS"))[0]).toMatch(/is a count/);
    expect(conditionErrors(c("FIND", "CURR_MIN", 424242, 1))).toEqual(["FIND no item 424242"]);
    expect(conditionErrors(c("ROOM", "BOOL_IS", 9999))).toEqual(["ROOM no room 9999"]);
    expect(conditionErrors(c("TRUST", "CURR_MIN", "santa", 1))).toEqual(["TRUST no resident santa"]);
    expect(conditionErrors(c("GIVE_TO", "CURR_MIN", "praline:424242", 1))).toEqual(["GIVE_TO no item 424242"]);
    expect(conditionErrors(c("MOVE", "CURR_MIN", undefined, -1))[0]).toMatch(/whole value/);
    expect(conditionErrors(c("MOVE", "CURR_MIN", undefined, 1.5))[0]).toMatch(/whole value/);
    expect(conditionErrors(c("MOVE", "CURR_MIN", 3, 1))[0]).toMatch(/takes no index/);
    expect(conditionErrors(c("ITEM", "CURR_MIN", undefined, 1))[0]).toMatch(/needs an index/);
    expect(conditionErrors(c("TIME_OF_DAY", "BOOL_IS", "noon"))[0]).toMatch(/no time of day/);
    expect(conditionErrors(c("QUEST", "BOOL_IS", "ghost"), { quests: new Set(["hello"]) })).toEqual(["QUEST no quest ghost"]);
    expect(conditionErrors(c("QUEST_DELAY", "BOOL_IS", "hello"))).toEqual(["QUEST_DELAY needs the delay in whole seconds"]);
    expect(conditionErrors(c("CHOOSE", "CURR_MIN", "Share!", 1))[0]).toMatch(/lower-case word/);
  });

  it("a bad sheet fails with the sheet and row named, every problem at once", () => {
    const rows = [
      { id: "fine", conditions: [c("MOVE", "CURR_MIN", undefined, 1)] },
      { id: "bad", conditions: [c("MOVE", "CURR_MIN", undefined, 1), c("FIND", "CURR_MIN", 424242, 1)] },
      { id: "fine", conditions: [] },
    ];
    expect(() => assertSheet("quests", rows)).toThrow(/quests bad condition 2: FIND no item 424242[\s\S]*quests fine: the id is used twice/);
    expect(() => assertSheet("quests", rows.slice(0, 1))).not.toThrow();
  });

  it("every resident and every room a sheet may name is known to the checker", () => {
    for (const ch of CHARACTERS) expect(conditionErrors(c("TRUST", "CURR_MIN", ch.id, 1))).toEqual([]);
    for (const r of Object.values(ROOMS)) expect(conditionErrors(c("ROOM", "BOOL_IS", r.index))).toEqual([]);
  });
});

describe("older saves", () => {
  it("are counted in once from what they record, and never twice", () => {
    const old: WorldState = { ...newWorld("s"), visited: [65, 1, 2, 3], foragedCount: 7, crafted: 2, trips: 1, garden: { plots: [], harvested: 3 } };
    delete old.tallied;
    delete old.tally;
    const ledger = { feed: 30, play: 12, clean: 4, petting: 9, medicine: 1, lessons: 5, sparWins: 2, gifts: 3, chainDays: 6 };
    const once = backfillTally(old, ledger);
    expect(tallyOf(once, "MOVE")).toBe(3);
    expect(tallyOf(once, "FORAGE")).toBe(7);
    expect(tallyOf(once, "CRAFT")).toBe(2);
    expect(tallyOf(once, "TRIP")).toBe(1);
    expect(tallyOf(once, "HARVEST")).toBe(3);
    expect(tallyOf(once, "CARE", "feed")).toBe(30);
    expect(tallyOf(once, "CARE", "pet")).toBe(9);
    expect(tallyOf(once, "CARE")).toBe(30 + 12 + 4 + 9 + 1);
    expect(tallyOf(once, "LESSON")).toBe(5);
    expect(tallyOf(once, "SPAR_WIN")).toBe(2);
    expect(tallyOf(once, "GIFT")).toBe(3);
    expect(tallyOf(once, "SAVE")).toBe(6);
    expect(backfillTally(once, ledger)).toBe(once);
    // a new world has nothing to count in
    expect(backfillTally(newWorld("n"), ledger)).toEqual(newWorld("n"));
  });

  it("keep whatever the tally already counted", () => {
    const partial: WorldState = { ...bump({ ...newWorld("s"), foragedCount: 4 }, "FORAGE", 0, 6) };
    delete partial.tallied;
    expect(tallyOf(backfillTally(partial, {}), "FORAGE")).toBe(6);
  });
});

describe("flags", () => {
  it("are set once, only as lower-case words, and read by FLAG", () => {
    const w = withFlag(withFlag(newWorld("s"), "named"), "named");
    expect(w.flags).toEqual(["named"]);
    expect(withFlag(w, "Named!")).toBe(w);
    expect(progressOf({ type: "FLAG", logic: "BOOL_IS", index: "named" }, { ...view(w) }).met).toBe(true);
    expect(progressOf({ type: "FLAG", logic: "BOOL_NOT", index: "door" }, { ...view(w) }).met).toBe(true);
  });
});

describe("the shipped sheets", () => {
  it("all pass the check", () => {
    expect(() => checkSheets(SHEETS)).not.toThrow();
  });
  it("one bad row anywhere fails the whole check, naming each sheet and row", () => {
    const bad = [
      { name: "story", rows: [{ id: "q1", conditions: [{ type: "ROOM", logic: "BOOL_IS", index: 9999 } as Condition] }] },
      { name: "daily", rows: [{ id: "d1", conditions: [{ type: "TRUST", logic: "CURR_MIN", index: "nobody", value: 1 } as Condition] }] },
    ];
    expect(() => checkSheets(bad)).toThrow(/story q1 condition 1: ROOM no room 9999\ndaily d1 condition 1: TRUST no resident nobody/);
  });
});
