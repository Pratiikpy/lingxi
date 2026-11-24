/**
 * Village happenings (D2, plan 38 section 2: "something new or changing every day through day 90"). Each day the
 * village has one happening, the same for every player on the same local day and different every day for 90 days: a
 * rare thing on sale at the Corner Shop, a lucky room where the first look around finds one more thing, or a resident
 * with a small gift for whoever talks to them. Nothing counts down and nothing is lost by missing one.
 */

import { RESIDENT_FRIENDS } from "./friends/residents";
import { localDay } from "./story";
import { bumpAll } from "./tally";
import {
  type ExploreMods,
  HOME,
  ITEM,
  NO_EXPLORE_MODS,
  ROOMS,
  type WorldResult,
  type WorldState,
  boostRare,
  pickDrop,
} from "./world";

export type HappeningKind = "market" | "lucky" | "gift";
export type Happening =
  | { kind: "market"; id: string; day: string; item: number; price: number }
  | { kind: "lucky"; id: string; day: string; room: number }
  | { kind: "gift"; id: string; day: string; who: string; item: number };

/** Praline's Corner Shop, where the day's market item is sold. */
export const MARKET_ROOM = 13;
/** How many of each kind there are: three kinds in turn, each with this many, so 90 days are all different. */
export const VILLAGE_VARIETY = 30;
const EPOCH = Date.UTC(2026, 10, 16);
const DAY = 86_400_000;

const bestChance = (item: number): number => {
  let best = 0;
  for (const r of Object.values(ROOMS)) {
    const total = r.drops.reduce((s, d) => s + d.weight, 0);
    const d = r.drops.find((x) => x.item === item);
    if (d && total > 0) best = Math.max(best, d.weight / total);
  }
  return best;
};

/** What the market offers: finds never on a shelf, the rarest first and dearer the rarer, then other shops' stock. */
export const MARKET_ITEMS: ReadonlyArray<{ item: number; price: number }> = (() => {
  const sold = new Set(Object.values(ROOMS).flatMap((r) => r.shop ?? []));
  const found = [...new Set(Object.values(ROOMS).flatMap((r) => r.drops.map((d) => d.item)))].filter(
    (i) => ITEM[i] && !sold.has(i),
  );
  found.sort((a, b) => bestChance(a) - bestChance(b) || a - b);
  const finds = found.map((item) => {
    const c = bestChance(item);
    // D24: "on sale" at prices a player who plays reaches within a day or two (it was 80 and 60 for the rarest, which an
    // early player could not reach on its market day), the rarest still the dearest
    return { item, price: c < 0.005 ? 50 : c < 0.01 ? 40 : c < 0.02 ? 30 : c < 0.1 ? 20 : 15 };
  });
  // then things other shops keep and the Corner Shop does not, at their own price
  const corner = new Set(ROOMS[MARKET_ROOM]?.shop ?? []);
  const elsewhere = [...sold]
    .filter((i) => !corner.has(i) && ITEM[i]?.price !== undefined)
    .sort((a, b) => a - b)
    .map((item) => ({ item, price: ITEM[item]!.price! }));
  return [...finds, ...elsewhere].slice(0, VILLAGE_VARIETY);
})();

/** The rooms a lucky day can fall on: every room with something to find, spread evenly. */
export const LUCKY_ROOMS: readonly number[] = (() => {
  const rooms = Object.values(ROOMS)
    .filter((r) => r.drops.length)
    .map((r) => r.index)
    .sort((a, b) => a - b);
  return Array.from(
    { length: Math.min(VILLAGE_VARIETY, rooms.length) },
    (_, k) => rooms[Math.floor((k * rooms.length) / VILLAGE_VARIETY)]!,
  );
})();

/** The residents' gifts: each resident in turn, each time the next thing they like that is a real item. */
export const VILLAGE_GIFTS: ReadonlyArray<{ who: string; item: number }> = (() => {
  const out: Array<{ who: string; item: number }> = [];
  const likes = RESIDENT_FRIENDS.map((f) => ({
    who: f.id,
    items: [...f.likes.love, ...f.likes.like].filter((i) => ITEM[i]),
  }));
  for (let k = 0; out.length < VILLAGE_VARIETY && k < VILLAGE_VARIETY * 4; k++) {
    const r = likes[k % likes.length]!;
    if (!r.items.length) continue;
    out.push({ who: r.who, item: r.items[Math.floor(k / likes.length) % r.items.length]! });
  }
  return out;
})();

/** The happening on a local day ("YYYY-MM-DD"). */
export function happeningOn(day: string): Happening {
  const n = Math.floor((Date.parse(`${day}T00:00:00Z`) - EPOCH) / DAY);
  const kind = (["market", "lucky", "gift"] as const)[((n % 3) + 3) % 3]!;
  const k = ((Math.floor(n / 3) % VILLAGE_VARIETY) + VILLAGE_VARIETY) % VILLAGE_VARIETY;
  if (kind === "market") {
    const m = MARKET_ITEMS[k % MARKET_ITEMS.length]!;
    return { kind, id: `market:${m.item}`, day, item: m.item, price: m.price };
  }
  if (kind === "lucky") {
    const room = LUCKY_ROOMS[k % LUCKY_ROOMS.length]!;
    return { kind, id: `lucky:${room}`, day, room };
  }
  const g = VILLAGE_GIFTS[k % VILLAGE_GIFTS.length]!;
  return { kind, id: `gift:${g.who}:${g.item}`, day, who: g.who, item: g.item };
}

/** The player's local day as the world keeps it (its time zone is saved when the day's errands are rolled). */
export const villageDay = (w: WorldState, now: number): string => localDay(now, w.tz ?? 0);
export const happeningAt = (w: WorldState, now: number): Happening => happeningOn(villageDay(w, now));

/** Has today's happening been made use of (the market item bought, the lucky room looked around, the gift taken)? */
export const happeningUsed = (w: WorldState, now: number): boolean =>
  w.village?.day === villageDay(w, now) && w.village.used === true;

const used = (w: WorldState, now: number): WorldState => ({ ...w, village: { day: villageDay(w, now), used: true } });

/**
 * D24: from this local hour the day's happening comes to the player: a resident's gift is left at the door, the lucky
 * room's extra find drifts home to the first look around there, and the market's last one goes at half price. A pet too
 * tired to walk, or a player who comes once in the evening, still meets the village that day.
 */
export const VILLAGE_EVENING = 18;
export const villageEvening = (w: WorldState, now: number): boolean =>
  new Date(now + (w.tz ?? 0) * 60_000).getUTCHours() >= VILLAGE_EVENING;

/** Today's market price: half (rounded up) in the evening. */
export function marketPrice(w: WorldState, now: number): number {
  const h = happeningAt(w, now);
  if (h.kind !== "market") return 0;
  return villageEvening(w, now) ? Math.ceil(h.price / 2) : h.price;
}

/** Whether today's resident gift is waiting at the door (an evening at home, not yet taken). */
export const giftAtDoor = (w: WorldState, now: number): boolean =>
  happeningAt(w, now).kind === "gift" && !happeningUsed(w, now) && villageEvening(w, now) && w.room === HOME;

/** Buy today's market item at the Corner Shop. */
export function buyMarket(w: WorldState, now: number): WorldResult<{ item: number }> {
  const h = happeningAt(w, now);
  if (h.kind !== "market" || w.room !== MARKET_ROOM) return { ok: false, reason: "notSold" };
  const price = marketPrice(w, now);
  if (w.coins < price) return { ok: false, reason: "coins" };
  const bag = { ...w.bag, [h.item]: (w.bag[h.item] ?? 0) + 1 };
  return {
    ok: true,
    item: h.item,
    world: bumpAll(used({ ...w, coins: w.coins - price, bag }, now), [
      ["BUY", h.item, 1],
      ["COINS_SPENT", 0, price],
      ["VILLAGE", 0, 1],
    ]),
  };
}

/** Today's resident gift, taken by talking to that resident; once a day. */
export function takeVillageGift(w: WorldState, who: string, now: number): WorldResult<{ item: number }> {
  const h = happeningAt(w, now);
  // the resident hands it over, or in the evening it waits at the door at home (who: "door")
  if (h.kind !== "gift" || (h.who !== who && !(who === "door" && giftAtDoor(w, now))))
    return { ok: false, reason: "noGift" };
  if (happeningUsed(w, now)) return { ok: false, reason: "already" };
  const bag = { ...w.bag, [h.item]: (w.bag[h.item] ?? 0) + 1 };
  return { ok: true, item: h.item, world: bumpAll(used({ ...w, bag }, now), [["VILLAGE", 0, 1]]) };
}

/** Whether a look around here and now gets the lucky room's extra find (and so uses the day's happening). */
export const luckyHere = (w: WorldState, now: number): boolean => {
  const h = happeningAt(w, now);
  return (
    h.kind === "lucky" && !happeningUsed(w, now) && (h.room === w.room || (w.room === HOME && villageEvening(w, now)))
  );
};

/** A small, stable hash (FNV-1a) of the seed, room and day, for the lucky room's extra find. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The lucky room's extra find, after a look around there (the caller has just looked around): one more thing from the
 * room, once on the lucky day. Null when today's happening is not this room or was used.
 */
export function luckyFind(
  w: WorldState,
  now: number,
  mods: ExploreMods = NO_EXPLORE_MODS,
): WorldResult<{ item: number }> {
  if (!luckyHere(w, now)) return { ok: false, reason: "notLucky" };
  // the lucky room's own drops, wherever the find is made (in the evening it drifts home)
  const h = happeningAt(w, now);
  const room = ROOMS[h.kind === "lucky" ? h.room : w.room]!;
  const item = pickDrop(
    boostRare(room.drops, mods.rareBoost),
    hash(`${w.seed}:${h.kind === "lucky" ? h.room : w.room}:${villageDay(w, now)}:lucky`),
  );
  const bag = { ...w.bag, [item]: (w.bag[item] ?? 0) + 1 };
  return {
    ok: true,
    item,
    world: bumpAll(used({ ...w, bag }, now), [
      ["VILLAGE", 0, 1],
      ["FIND", item, 1],
    ]),
  };
}
