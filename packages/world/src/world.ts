/**
 * The world: rooms on a grid you walk between, things to find, a shop, a
 * workbench and quests. Pure functions over a small saved state; every random
 * find is decided by a hash of (seed, room, hour), so it cannot be rerolled by
 * reloading.
 */

import { sha256 } from "@noble/hashes/sha2";
import data from "./data/world.json";
import { ITEMS, type ItemDef, RECIPE_NAMES } from "./items";
import { ROOM_TEXT, type RoomText } from "./rooms";

export const HOME = 65;
export const MOVE_ENERGY = 15;
export const FORAGE_ENERGY = 10;
export const FIRST_VISIT_COINS = 5;

export interface Room extends RoomText {
  index: number;
  x: number;
  y: number;
  z: number;
  bgs: { day: string; evening: string; night: string };
  /** rarity tier from the sheet (1 rare … 9 common) and the weight made from it */
  drops: Array<{ item: number; tier: number; weight: number }>;
  shop: number[];
}

export interface Item extends ItemDef {
  index: number;
  art: string;
}

export interface Recipe {
  index: number;
  name: { en: string; zh: string };
  out: number;
  outAmount: number;
  ins: Array<{ item: number; amount: number }>;
}

/** Rooms that sell things, and what. */
const SHOPS: Record<number, number[]> = {
  13: [11130, 11110, 11120, 11140, 11302, 11304, 11313, 21201, 21202, 21203, 11201, 11233, 7104, 7103, 7102, 7101],
  4: [11301, 11303, 11409, 21201, 11201, 11202],
};

/** Lingxi's own items, drawn for the garden rather than taken from the world data */
const OWN_ART: Record<number, string> = {
  7001: "art/items/garden/compost.png",
  7101: "art/items/garden/seed_apple.png",
  7102: "art/items/garden/seed_rice.png",
  7103: "art/items/garden/seed_pepper.png",
  7104: "art/items/garden/seed_clover.png",
  7201: "art/items/garden/rice_sheaf.png",
  7202: "art/items/garden/garden_pepper.png",
};

export const ITEM: Record<number, Item> = Object.fromEntries([
  ...(data.items as Array<{ index: number; art: string }>).filter((i) => ITEMS[i.index]).map((i) => [i.index, { ...ITEMS[i.index]!, index: i.index, art: i.art }]),
  ...Object.entries(OWN_ART).map(([k, art]) => [Number(k), { ...ITEMS[Number(k)]!, index: Number(k), art }]),
]);

/** A rarity tier from the world sheet becomes a weight: tier 9 is 256 times as common as tier 1, tier 0 never drops. */
export const tierWeight = (tier: number): number => (tier >= 1 ? 2 ** (tier - 1) : 0);

/** Walk the cumulative weights with a random number; one rule for looking around, walks and away finds. */
export function pickDrop(drops: ReadonlyArray<{ item: number; weight: number }>, r: number): number {
  const total = drops.reduce((s, d) => s + d.weight, 0);
  let x = r % total;
  for (const d of drops) {
    if (x < d.weight) return d.item;
    x -= d.weight;
  }
  return drops[0]!.item;
}

export const ROOMS: Record<number, Room> = Object.fromEntries(
  // the sheet's "weight" column holds the rarity tier, not the weight
  (data.rooms as Array<{ index: number; x: number; y: number; z: number; bgs: Room["bgs"]; drops: Array<{ item: number; weight: number }> }>)
    .filter((r) => ROOM_TEXT[r.index])
    .map((r) => [
      r.index,
      {
        ...ROOM_TEXT[r.index]!,
        index: r.index,
        x: r.x,
        y: r.y,
        z: r.z,
        bgs: r.bgs,
        drops: r.drops.filter((d) => ITEM[d.item]).map((d) => ({ item: d.item, tier: d.weight, weight: tierWeight(d.weight) })),
        shop: SHOPS[r.index] ?? [],
      },
    ]),
);

const EXITS: Array<[number, number]> = (data.rooms as Array<{ index: number; exits: number[] }>).flatMap((r) => r.exits.map((e) => [r.index, e] as [number, number]));

/** Small numbers for Lingxi: bulk amounts (hundreds of pollen) become a handful. */
const scale = (n: number) => (n > 10 ? 3 : n);

export const RECIPES: Recipe[] = (data.recipes as Array<{ index: number; out: number; outAmount: number; ins: Array<{ item: number; amount: number }> }>)
  .filter((r) => RECIPE_NAMES[r.index] && ITEM[r.out] && r.ins.every((x) => ITEM[x.item]))
  .map((r) => ({ index: r.index, name: RECIPE_NAMES[r.index]!, out: r.out, outAmount: Math.max(1, r.outAmount), ins: r.ins.map((x) => ({ item: x.item, amount: scale(x.amount) })) }));

/** Recipes only a trip teaches: the garden's harvest turned into mochi. */
export const TRAVEL_RECIPES: readonly Recipe[] = [
  { index: 20001, name: { en: "Pound Rice Mochi", zh: "捣米麻薯" }, out: 11130, outAmount: 2, ins: [{ item: 7201, amount: 2 }, { item: 11312, amount: 1 }] },
  { index: 20002, name: { en: "Fold Apple Jam Mochi", zh: "包苹果酱麻薯" }, out: 11120, outAmount: 2, ins: [{ item: 11313, amount: 2 }, { item: 7201, amount: 1 }] },
  { index: 20003, name: { en: "Roll Honey Mochi", zh: "滚蜂蜜麻薯" }, out: 11140, outAmount: 2, ins: [{ item: 11312, amount: 2 }, { item: 7201, amount: 1 }] },
];

export function neighbours(index: number): number[] {
  const r = ROOMS[index];
  if (!r) return [];
  const out = new Set<number>();
  for (const o of Object.values(ROOMS)) {
    if (o.index !== index && o.z === r.z && Math.abs(o.x - r.x) + Math.abs(o.y - r.y) === 1) out.add(o.index);
  }
  for (const [a, b] of EXITS) {
    if (a === index && ROOMS[b]) out.add(b);
    if (b === index && ROOMS[a]) out.add(a);
  }
  return [...out].sort((a, b) => a - b);
}

/* ── the player's world state ────────────────────────────────────────────── */

export interface WorldState {
  version: 1;
  room: number;
  coins: number;
  bag: Record<number, number>;
  visited: number[];
  /** room -> hour key of the last forage there */
  foraged: Record<number, number>;
  crafted: number;
  foragedCount: number;
  /** per-player salt so two players find different things */
  seed: string;
  /** quest ids already claimed */
  claimed: string[];
  /** a walk in progress, and how many walks today brought finds (see outings.ts) */
  walk?: { startedAt: number; steps: number; sensor: boolean; finds: Array<{ item: number; n: number }> };
  walksDay?: number;
  walksToday?: number;
  /** the pet away on a trip, travel recipes it has brought back, and trips taken */
  trip?: { to: string; leftAt: number; backAt: number };
  recipes?: number[];
  trips?: number;
  /** outfit pieces owned, and what each pet wears (see wardrobe.ts) */
  wardrobe?: { owned: string[]; worn: Record<string, Partial<Record<"head" | "face" | "held", string>>> };
  /** the Mushroom Garden's plots (see garden.ts) */
  garden?: { plots: Array<{ crop: string; at: number; compost: boolean } | null>; harvested: number };
  /** decorations bought and where they stand in the home room */
  decor?: { owned: string[]; placed: Array<{ id: string; x: number; y: number }> };
}

export function newWorld(seed: string): WorldState {
  return {
    version: 1,
    room: HOME,
    coins: 30,
    bag: { 11130: 3, 11313: 2, 11301: 2 },
    visited: [HOME],
    foraged: {},
    crafted: 0,
    foragedCount: 0,
    seed,
    claimed: [],
  };
}

export type WorldResult<T extends object = object> = ({ ok: true; world: WorldState } & T) | { ok: false; reason: string };

const add = (bag: Record<number, number>, item: number, n: number): Record<number, number> => {
  const next = { ...bag, [item]: (bag[item] ?? 0) + n };
  if (next[item]! <= 0) delete next[item];
  return next;
};

export const has = (w: WorldState, item: number, n = 1): boolean => (w.bag[item] ?? 0) >= n;

/** Walk to a neighbouring room. The caller spends MOVE_ENERGY from the pet. */
export function move(w: WorldState, to: number, petEnergy: number): WorldResult<{ firstVisit: boolean; coins: number }> {
  if (!ROOMS[to]) return { ok: false, reason: "noRoom" };
  if (!neighbours(w.room).includes(to)) return { ok: false, reason: "notNear" };
  if (petEnergy < MOVE_ENERGY) return { ok: false, reason: "tired" };
  const firstVisit = !w.visited.includes(to);
  const coins = firstVisit ? FIRST_VISIT_COINS : 0;
  return {
    ok: true,
    firstVisit,
    coins,
    world: { ...w, room: to, visited: firstVisit ? [...w.visited, to] : w.visited, coins: w.coins + coins },
  };
}

const hourKey = (now: number) => Math.floor(now / 3_600_000);

function roll(seed: string, room: number, hour: number, salt: number): number {
  const h = sha256(new TextEncoder().encode(`${seed}:${room}:${hour}:${salt}`));
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
}

/** Look around the current room. Once per room per hour; the caller spends FORAGE_ENERGY. */
export function forage(w: WorldState, now: number, petEnergy: number): WorldResult<{ found: Array<{ item: number; n: number }> }> {
  const room = ROOMS[w.room];
  if (!room) return { ok: false, reason: "noRoom" };
  if (!room.drops.length) return { ok: false, reason: "nothingHere" };
  const hour = hourKey(now);
  if (w.foraged[w.room] === hour) return { ok: false, reason: "already" };
  if (petEnergy < FORAGE_ENERGY) return { ok: false, reason: "tired" };
  const pick = (salt: number) => pickDrop(room.drops, roll(w.seed, w.room, hour, salt));
  const count = 1 + (roll(w.seed, w.room, hour, 99) % 3 === 0 ? 1 : 0);
  const found: Array<{ item: number; n: number }> = [];
  for (let i = 0; i < count; i++) {
    const item = pick(i);
    const f = found.find((x) => x.item === item);
    if (f) f.n += 1;
    else found.push({ item, n: 1 });
  }
  let bag = w.bag;
  for (const f of found) bag = add(bag, f.item, f.n);
  return { ok: true, found, world: { ...w, bag, foraged: { ...w.foraged, [w.room]: hour }, foragedCount: w.foragedCount + 1 } };
}

export function buy(w: WorldState, item: number): WorldResult {
  const room = ROOMS[w.room];
  const def = ITEM[item];
  if (!room || !def || !room.shop.includes(item) || def.price === undefined) return { ok: false, reason: "notSold" };
  if (w.coins < def.price) return { ok: false, reason: "coins" };
  return { ok: true, world: { ...w, coins: w.coins - def.price, bag: add(w.bag, item, 1) } };
}

export function craft(w: WorldState, recipeIndex: number): WorldResult<{ made: number }> {
  // a travel recipe works only once a trip has brought it home
  const r = RECIPES.find((x) => x.index === recipeIndex) ?? TRAVEL_RECIPES.find((x) => x.index === recipeIndex && (w.recipes ?? []).includes(x.index));
  if (!r) return { ok: false, reason: "noRecipe" };
  if (!r.ins.every((x) => has(w, x.item, x.amount))) return { ok: false, reason: "missing" };
  let bag = w.bag;
  for (const x of r.ins) bag = add(bag, x.item, -x.amount);
  bag = add(bag, r.out, r.outAmount);
  return { ok: true, made: r.out, world: { ...w, bag, crafted: w.crafted + 1 } };
}

/** Take an item out of the bag to use on the pet. Returns its effect for the game rules. */
export function take(w: WorldState, item: number): WorldResult<{ use: NonNullable<ItemDef["use"]> }> {
  const def = ITEM[item];
  if (!def?.use) return { ok: false, reason: "cantUse" };
  if (!has(w, item)) return { ok: false, reason: "none" };
  return { ok: true, use: def.use, world: { ...w, bag: add(w.bag, item, -1) } };
}

/** Open a River Box: two or three things from the deep pools, decided by the box's own roll. */
export function openBox(w: WorldState, now: number): WorldResult<{ found: Array<{ item: number; n: number }> }> {
  if (!has(w, 21007)) return { ok: false, reason: "none" };
  const pool = [1007, 1010, 1021, 1019, 11312, 11314, 6001, 6002, 6003, 6004, 6005, 6006, 11222];
  const salt = (w.bag[21007] ?? 0) + w.crafted * 7 + w.foragedCount * 13;
  const found: Array<{ item: number; n: number }> = [];
  const n = 2 + (roll(w.seed, 21007, hourKey(now), salt) % 2);
  for (let i = 0; i < n; i++) {
    const item = pool[roll(w.seed, 21007, hourKey(now), salt * 31 + i) % pool.length]!;
    const f = found.find((x) => x.item === item);
    if (f) f.n += 1;
    else found.push({ item, n: 1 });
  }
  let bag = add(w.bag, 21007, -1);
  for (const f of found) bag = add(bag, f.item, f.n);
  return { ok: true, found, world: { ...w, bag } };
}

export const earn = (w: WorldState, coins: number): WorldState => ({ ...w, coins: w.coins + coins });
export const give = (w: WorldState, item: number, n = 1): WorldState => ({ ...w, bag: add(w.bag, item, n) });

import { QUESTS, type QuestView, questState } from "./quests";

/** Claim a finished quest's reward. */
export function claim(w: WorldState, id: string, view: Omit<QuestView, "world">): WorldResult<{ coins: number; items: Array<{ item: number; n: number }> }> {
  const q = QUESTS.find((x) => x.id === id);
  if (!q) return { ok: false, reason: "noQuest" };
  if (questState(q, { ...view, world: w }, w.claimed) !== "ready") return { ok: false, reason: "notReady" };
  let next = earn({ ...w, claimed: [...w.claimed, id] }, q.reward.coins);
  for (const it of q.reward.items ?? []) next = give(next, it.item, it.n);
  return { ok: true, coins: q.reward.coins, items: q.reward.items ?? [], world: next };
}
