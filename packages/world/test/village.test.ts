/**
 * D2: a village happening every day, different every day for 90 days, each with an effect a player can use that day.
 */
import { describe, expect, it } from "vitest";
import {
  LUCKY_ROOMS,
  MARKET_ITEMS,
  MARKET_ROOM,
  VILLAGE_GIFTS,
  buyMarket,
  happeningAt,
  happeningOn,
  happeningUsed,
  luckyFind,
  newWorld,
  takeVillageGift,
  type WorldState,
} from "../src";

const day = (n: number) => new Date(Date.UTC(2026, 10, 23) + n * 86_400_000).toISOString().slice(0, 10);
const at = (d: string, hour = 10) => Date.parse(`${d}T00:00:00Z`) + hour * 3_600_000;

describe("village happenings (D2)", () => {
  it("are different every day for at least 90 days, and of all three kinds", () => {
    const ids = Array.from({ length: 90 }, (_, n) => happeningOn(day(n)).id);
    expect(new Set(ids).size).toBe(90);
    expect(new Set(Array.from({ length: 3 }, (_, n) => happeningOn(day(n)).kind)).size).toBe(3);
    expect(MARKET_ITEMS.length).toBe(30);
    expect(LUCKY_ROOMS.length).toBe(30);
    expect(VILLAGE_GIFTS.length).toBe(30);
  });

  it("a market day sells its rare item at the Corner Shop, once used", () => {
    const d = Array.from({ length: 6 }, (_, n) => day(n)).find((x) => happeningOn(x).kind === "market")!;
    const h = happeningOn(d) as Extract<ReturnType<typeof happeningOn>, { kind: "market" }>;
    const w: WorldState = { ...newWorld("v"), coins: 500, room: MARKET_ROOM };
    expect(buyMarket({ ...w, room: 1 }, at(d))).toEqual({ ok: false, reason: "notSold" });
    const r = buyMarket(w, at(d));
    if (!r.ok) throw new Error(r.reason);
    expect(r.world.bag[h.item]).toBe(1);
    expect(r.world.coins).toBe(500 - h.price);
    expect(happeningUsed(r.world, at(d))).toBe(true);
  });

  it("a lucky day gives the first look around in its room one more thing, once", () => {
    const d = Array.from({ length: 6 }, (_, n) => day(n)).find((x) => happeningOn(x).kind === "lucky")!;
    const h = happeningOn(d) as Extract<ReturnType<typeof happeningOn>, { kind: "lucky" }>;
    const w: WorldState = { ...newWorld("v"), room: h.room };
    const r = luckyFind(w, at(d));
    if (!r.ok) throw new Error(r.reason);
    expect(r.world.bag[r.item]).toBe((w.bag[r.item] ?? 0) + 1);
    expect(luckyFind(r.world, at(d))).toEqual({ ok: false, reason: "notLucky" });
    expect(luckyFind({ ...w, room: h.room + 1 }, at(d)).ok).toBe(false);
  });

  it("a gift day gives the resident's gift to whoever talks to them, once", () => {
    const d = Array.from({ length: 6 }, (_, n) => day(n)).find((x) => happeningOn(x).kind === "gift")!;
    const h = happeningOn(d) as Extract<ReturnType<typeof happeningOn>, { kind: "gift" }>;
    const w = newWorld("v");
    expect(takeVillageGift(w, h.who === "wick" ? "bolt" : "wick", at(d)).ok).toBe(false);
    const r = takeVillageGift(w, h.who, at(d));
    if (!r.ok) throw new Error(r.reason);
    expect(r.world.bag[h.item]).toBe((w.bag[h.item] ?? 0) + 1);
    expect(takeVillageGift(r.world, h.who, at(d))).toEqual({ ok: false, reason: "already" });
  });

  it("follows the player's own day once its time zone is known", () => {
    const w: WorldState = { ...newWorld("v"), tz: 480 };
    // 20:00 UTC is already tomorrow at UTC+8
    const d = day(0);
    expect(happeningAt(w, at(d, 20)).id).toBe(happeningOn(day(1)).id);
    expect(happeningAt({ ...w, tz: 0 }, at(d, 20)).id).toBe(happeningOn(d).id);
  });

  it("rolling the day's errands saves the player's time zone, so the village follows their own day", async () => {
    const { rollDailies, DAILIES } = await import("../src");
    const world = newWorld("tz");
    const v = {
      world,
      pet: { level: 1, stage: "baby" as const, onChain: false, needsMin: 500 },
      pets: 1,
      now: Date.UTC(2026, 10, 23, 20),
      timeOfDay: 2 as const,
      day: "2026-11-24",
      bondLevel: 0,
      goalsDone: [] as string[],
    };
    const w = rollDailies(world, DAILIES, v, 480);
    expect(w.tz).toBe(480);
    // a save whose day was rolled before it kept a time zone gets one on the same day
    const { tz: _drop, ...old } = w;
    expect(rollDailies(old, DAILIES, { ...v, world: old }, 480).tz).toBe(480);
  });
});

describe("in the evening the village comes home (D24)", () => {
  const dayOf = async (kind: "market" | "lucky" | "gift") => {
    const { happeningOn } = await import("../src");
    for (let d = 0; d < 9; d++) {
      const day = new Date(Date.UTC(2026, 10, 20) + d * 86_400_000).toISOString().slice(0, 10);
      if (happeningOn(day).kind === kind) return day;
    }
    throw new Error(kind);
  };
  // a UTC+8 player: 10:00 and 19:00 local on that day
  const at = (day: string, hour: number) => Date.parse(`${day}T00:00:00Z`) + (hour - 8) * 3_600_000;

  it("a resident's gift waits at the door from 6 pm, at home only, once", async () => {
    const { newWorld, takeVillageGift, giftAtDoor, HOME } = await import("../src");
    const day = await dayOf("gift");
    const w = { ...newWorld("door"), tz: 480, room: HOME };
    expect(giftAtDoor(w, at(day, 10))).toBe(false);
    expect(takeVillageGift(w, "door", at(day, 10)).ok).toBe(false);
    expect(giftAtDoor({ ...w, room: 13 }, at(day, 19))).toBe(false);
    const r = takeVillageGift(w, "door", at(day, 19));
    expect(r.ok).toBe(true);
    if (r.ok) expect(takeVillageGift(r.world, "door", at(day, 20)).ok).toBe(false);
  });

  it("the lucky find drifts home in the evening, still from the lucky room's own drops", async () => {
    const { newWorld, luckyHere, luckyFind, happeningOn, ROOMS, HOME } = await import("../src");
    const day = await dayOf("lucky");
    const w = { ...newWorld("luck"), tz: 480, room: HOME };
    expect(luckyHere(w, at(day, 10))).toBe(false);
    expect(luckyHere(w, at(day, 19))).toBe(true);
    const r = luckyFind(w, at(day, 19));
    expect(r.ok).toBe(true);
    const room = (happeningOn(day) as { room: number }).room;
    if (r.ok) expect(ROOMS[room]!.drops.map((d) => d.item)).toContain(r.item);
  });

  it("the market's find is half price (rounded up) from 6 pm, and buying charges that", async () => {
    const { newWorld, marketPrice, buyMarket, happeningOn, MARKET_ROOM } = await import("../src");
    const day = await dayOf("market");
    const full = (happeningOn(day) as { price: number }).price;
    const w = { ...newWorld("sale"), tz: 480, room: MARKET_ROOM, coins: 500 };
    expect(marketPrice(w, at(day, 10))).toBe(full);
    expect(marketPrice(w, at(day, 19))).toBe(Math.ceil(full / 2));
    const r = buyMarket(w, at(day, 19));
    expect(r.ok && r.world.coins).toBe(500 - Math.ceil(full / 2));
  });
});
