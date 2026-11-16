import { describe, expect, it } from "vitest";
import { endWalk, startWalk } from "../src/outings";
import { DESTINATIONS } from "../src/outings";
import { CROPS } from "../src/garden";
import { STORY } from "../src/questline";
import { DAILIES, WEEKLY_GIFT } from "../src/questline/dailies";
import { RECIPES, ROOM_SECRETS, TRAVEL_RECIPES } from "../src/world";
import { BOX_TABLES, ITEM, ROOMS, type WorldState, addBuff, affinitiesOf, familiarGain, forage, give, newWorld, openBox, spendSparBuffs, take, usedOf } from "../src/world";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 16, 9);
const world = (seed = "s"): WorldState => ({ ...newWorld(seed), bag: {} });

describe("boxes open by their own tables (plan 4.5)", () => {
  it("has a table for every box in the bag that can be opened, holding only items that exist", () => {
    expect(Object.keys(BOX_TABLES).map(Number).sort()).toEqual([21003, 21004, 21005, 21007, 21008]);
    for (const [box, rows] of Object.entries(BOX_TABLES)) {
      expect(ITEM[Number(box)]?.kind, box).toBe("box");
      for (const r of rows) expect(ITEM[r.item], `${box} → ${r.item}`).toBeDefined();
    }
    // the enemy potion in the Golden Box's source table stays out: Lingxi has no way to hurt a pet
    expect(BOX_TABLES[21008]!.some((r) => r.item === 19301)).toBe(false);
  });

  it.each([21003, 21004, 21005, 21007])("box %i: 100,000 opens land on each item at its 2^(tier-1) share", (box) => {
    const rows = BOX_TABLES[box]!;
    const total = rows.reduce((s, r) => s + r.weight, 0);
    const seen = new Map<number, number>();
    let draws = 0;
    for (let i = 0; i < 100_000; i++) {
      const r = openBox(give(world(`b${i}`), box, 1), T0, box);
      if (!r.ok) throw new Error(r.reason);
      for (const f of r.found) {
        seen.set(f.item, (seen.get(f.item) ?? 0) + f.n);
        draws += f.n;
      }
    }
    for (const row of rows) {
      const want = row.weight / total;
      const got = (seen.get(row.item) ?? 0) / draws;
      // four standard errors of a binomial share: a real bias fails, chance does not
      const se = Math.sqrt((want * (1 - want)) / draws);
      expect(Math.abs(got - want), `${box}: ${ITEM[row.item]!.name.en} ${got.toFixed(4)} vs ${want.toFixed(4)}`).toBeLessThan(4 * se + 1e-9);
    }
  });

  it("a River Box draws two or three; the others draw one", () => {
    const counts = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const r = openBox(give(world(`r${i}`), 21007, 1), T0);
      if (r.ok) counts.add(r.found.reduce((s, f) => s + f.n, 0));
    }
    expect([...counts].sort()).toEqual([2, 3]);
    const one = openBox(give(world(), 21004, 1), T0, 21004);
    expect(one.ok && one.found.reduce((s, f) => s + f.n, 0)).toBe(1);
  });

  it("a Golden Box holds five Booster Packs and one more thing, and is used up", () => {
    const r = openBox(give(world(), 21008, 1), T0, 21008);
    if (!r.ok) throw new Error(r.reason);
    expect(r.found.find((f) => f.item === 21004)?.n).toBeGreaterThanOrEqual(5);
    expect(r.found.reduce((s, f) => s + f.n, 0)).toBe(6);
    expect(r.world.bag[21008] ?? 0).toBe(0);
  });

  it("the same box on the same hour gives the same thing, so a reload cannot reroll it", () => {
    const w = give(world("same"), 21003, 1);
    expect(openBox(w, T0, 21003)).toEqual(openBox(w, T0 + 1000, 21003));
  });

  it("refuses what is not a box, or a box you do not have", () => {
    expect(openBox(give(world(), 1001, 1), T0, 1001)).toEqual({ ok: false, reason: "notABox" });
    expect(openBox(world(), T0, 21004)).toEqual({ ok: false, reason: "none" });
  });
});

describe("item rules (plan 4.5)", () => {
  it("a limited item stops at its limit, counted across every use", () => {
    let w = give(world(), 11223, 5);
    for (let i = 0; i < 3; i++) {
      const r = take(w, 11223);
      if (!r.ok) throw new Error(r.reason);
      w = r.world;
    }
    expect(usedOf(w, 11223)).toBe(3);
    expect(take(w, 11223)).toEqual({ ok: false, reason: "limit" });
    expect(w.bag[11223]).toBe(2);
  });

  it("a potion hands back its cup", () => {
    const r = take(give(world(), 11410, 1), 11410);
    if (!r.ok) throw new Error(r.reason);
    expect([r.world.bag[11410] ?? 0, r.world.bag[1102]]).toEqual([0, 1]);
  });

  it("bonuses stack until spent, and a spar spends only its own", () => {
    let w = give(give(world(), 11224, 2), 11225, 1);
    for (const item of [11224, 11224, 11225]) {
      const r = take(w, item);
      if (!r.ok) throw new Error(r.reason);
      w = r.world;
    }
    expect(w.buffs).toEqual({ sparPower: 2, forageExtra: 1 });
    const s = spendSparBuffs(w);
    expect([s.power, s.hp, s.lossCoins]).toEqual([2, 0, 0]);
    expect(s.world.buffs).toEqual({ forageExtra: 1 });
    expect(addBuff(undefined, { sparHp: 5 })).toEqual({ sparHp: 5 });
  });

  it("a readied jewel adds one find to the next look around, then is gone", () => {
    const room = Object.values(ROOMS).find((r) => r.drops.length && r.familiarSize === 0) ?? Object.values(ROOMS).find((r) => r.drops.length)!;
    const base: WorldState = { ...world("j"), room: room.index };
    const plain = forage(base, T0, 1000);
    const jewelled = forage({ ...base, buffs: { forageExtra: 1 } }, T0, 1000);
    if (!plain.ok || !jewelled.ok) throw new Error("forage");
    const n = (f: Array<{ n: number }>) => f.reduce((s, x) => s + x.n, 0);
    expect(n(jewelled.found) - n(plain.found)).toBe(1);
    expect(jewelled.world.buffs?.forageExtra).toBeUndefined();
  });

  it("leaves the hostile potions out: nothing in Lingxi hurts a pet", () => {
    for (const id of [19101, 19201, 19301]) expect(ITEM[id], String(id)).toBeUndefined();
    // the two that are kind in Lingxi's version (glue mends a toy, the flash charm cheers) can be sent to a friend's pet
    expect([ITEM[19001]?.friend, ITEM[11412]?.friend]).toEqual([true, true]);
  });

  it("names and describes every item in both languages, with no outside game's name in them", () => {
    for (const [id, it] of Object.entries(ITEM)) {
      for (const s of [it.name.en, it.name.zh, it.desc.en, it.desc.zh]) {
        expect(s.trim().length, id).toBeGreaterThan(0);
        expect(/pet|coin/i.test(s), `${id}: ${s}`).toBe(false);
      }
    }
  });

  it("tools are sold and never used up; XP items fit the level curve (no single item worth a week of care)", () => {
    for (const t of [23100, 23101, 23102]) {
      expect(ITEM[t]?.kind).toBe("tool");
      expect(ROOMS[13]!.shop).toContain(t);
    }
    // a caring day earns about 27 experience
    for (const it of Object.values(ITEM)) expect(it.use?.xp ?? 0, it.name.en).toBeLessThanOrEqual(200);
  });
});

describe("room familiarity (plan 4.5)", () => {
  const room = Object.values(ROOMS).find((r) => r.drops.length && r.familiarSize >= 4 && r.affinity.includes("Normal"))!;

  it("knows each room's kind and bar size from the sheet", () => {
    expect(room).toBeDefined();
    expect(Object.values(ROOMS).some((r) => r.affinity.length === 2)).toBe(true);
    // every room with finds has a bar of at least two looks
    for (const r of Object.values(ROOMS)) if (r.drops.length) expect(r.familiarSize, r.name.en).toBeGreaterThanOrEqual(2);
  });

  it("a gentle pet learns a Normal place twice as fast; a brave pet is at home in eerie ones too", () => {
    expect(affinitiesOf("gentle")).toEqual(["Normal"]);
    expect(affinitiesOf("bold", true)).toEqual(["Scrap", "Eerie"]);
    expect(familiarGain(room, ["Normal"])).toBe(2);
    expect(familiarGain(room, ["Insect"])).toBe(1);
  });

  it("fills the bar look by look, shows one rare find when full, and starts again", () => {
    let w: WorldState = { ...world("f"), room: room.index };
    let filledAt = -1;
    for (let i = 0; i < room.familiarSize + 1; i++) {
      const r = forage(w, T0 + i * HOUR, 1000, undefined, ["Insect"]);
      if (!r.ok) throw new Error(r.reason);
      if (r.familiar?.filled) {
        filledAt = i;
        const rarest = Math.min(...room.drops.map((d) => d.tier));
        const secret = room.drops.filter((d) => d.tier <= Math.max(4, rarest)).map((d) => d.item);
        expect(r.found.some((f) => secret.includes(f.item))).toBe(true);
      }
      w = r.world;
    }
    expect(filledAt).toBe(room.familiarSize - 1);
    expect(w.familiar?.[room.index]).toBe(1);
  });

  it("a walk with finds makes the room it set out from more familiar, never past a full bar", () => {
    const start = startWalk({ ...world("w"), room: room.index }, T0, false);
    if (!start.ok) throw new Error(start.reason);
    const done = endWalk(start.world, T0 + 30 * 60_000);
    if (!done.ok) throw new Error(done.reason);
    expect(done.finds.length).toBeGreaterThan(0);
    expect(done.world.familiar?.[room.index]).toBe(1);
    const full = endWalk({ ...start.world, familiar: { [room.index]: room.familiarSize } }, T0 + 30 * 60_000);
    expect(full.ok && full.world.familiar?.[room.index]).toBe(room.familiarSize);
  });
});

describe("every item can be had (plan 4.5 audit)", () => {
  it("each item is found, sold, made, unboxed, harvested, revealed or given by a quest", () => {
    const from = new Set<number>([7001, 21004]); // compost from cleaning; booster packs in every Golden Box
    for (const r of Object.values(ROOMS)) [...r.drops.map((d) => d.item), ...r.shop].forEach((i) => from.add(i));
    for (const rows of Object.values(BOX_TABLES)) rows.forEach((d) => from.add(d.item));
    for (const r of [...RECIPES, ...TRAVEL_RECIPES]) from.add(r.out);
    for (const d of DESTINATIONS) d.drops.forEach((x) => from.add(x.item));
    for (const i of Object.values(ROOM_SECRETS)) from.add(i);
    const quests = JSON.stringify([STORY, DAILIES, WEEKLY_GIFT]);
    const crops = JSON.stringify(CROPS);
    const none = Object.keys(ITEM).map(Number).filter((i) => !from.has(i) && !quests.includes(String(i)) && !crops.includes(String(i)));
    expect(none.map((i) => `${i} ${ITEM[i]!.name.en}`)).toEqual([]);
  });

  it("a room's own secret comes the first time its bar fills, then rare finds again", () => {
    const room = ROOMS[87]!;
    let w: WorldState = { ...world("sec"), room: 87, familiar: { 87: room.familiarSize - 1 } };
    const first = forage(w, T0, 1000);
    if (!first.ok) throw new Error(first.reason);
    expect(first.found.some((f) => f.item === 100003)).toBe(true);
    w = { ...first.world, familiar: { 87: room.familiarSize - 1 } };
    const again = forage(w, T0 + HOUR, 1000);
    if (!again.ok) throw new Error(again.reason);
    expect(again.familiar?.filled).toBe(true);
    expect(again.found.some((f) => f.item === 100003)).toBe(false);
  });
});
