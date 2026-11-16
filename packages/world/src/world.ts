/**
 * The world: rooms on a grid you walk between, things to find, a shop, a
 * workbench and quests. Pure functions over a small saved state; every random
 * find is decided by a hash of (seed, room, hour), so it cannot be rerolled by
 * reloading.
 */

import type { GoalClaims } from "./goals";
import type { FriendsState } from "./friendship";
import { sha256 } from "@noble/hashes/sha2";
import { bump, bumpAll, bumpFinds } from "./tally";
import type { QuestBook } from "./story";
import data from "./data/world.json";
import { familiarStep, isRareTier, tierWeight } from "./rules";
import { type Buff, ITEMS, type ItemDef, RECIPE_NAMES } from "./items";
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
  /** the kinds of pet at home here (the source's room affinity): Normal, Insect, Scrap, Eerie */
  affinity: Affinity[];
  /** looks around that fill this room's familiarity bar; 0 = no bar (plan 4.5, the source's scavenge cost / 50) */
  familiarSize: number;
}

export type Affinity = "Normal" | "Insect" | "Scrap" | "Eerie";
const AFFINITIES: readonly Affinity[] = ["Normal", "Insect", "Scrap", "Eerie"];

/** Which rooms a pet is at home in: its line's kind, and the eerie places if it is brave. */
export function affinitiesOf(line: "gentle" | "bold" | "curious", brave = false): Affinity[] {
  const own: Affinity = line === "gentle" ? "Normal" : line === "curious" ? "Insect" : "Scrap";
  return brave ? [own, "Eerie"] : [own];
}

/**
 * What some rooms keep for those who know them: the first time the bar fills there, this is the hidden find (after
 * that, a rare find of the room's own). The three parts of the Sky Sextant live here, so its recipe can be finished.
 */
export const ROOM_SECRETS: Readonly<Record<number, number>> = {
  88: 100001, // Treasure Hall: the Star Disk
  84: 100002, // Mine Tunnel: the Old Gear
  87: 100003, // Sunken Temple: the Temple Map
  53: 11413, // Blooming Tree: Mistletoe
};

/** Familiarity a look around adds: two where the pet is at home, one elsewhere. */
export const familiarGain = (room: Room, kin: readonly Affinity[]) => familiarStep(room.affinity.some((a) => kin.includes(a)));

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
  /** a tool that must be in the bag; it is not used up (plan 4.5) */
  tool?: number;
  /** pet energy the work costs */
  energy: number;
  /** experience it gives the pet */
  xp: number;
  /** the only room it can be made in */
  room?: number;
}

/** Rooms that sell things, and what. Praline's shop has the crafting tools ("hobby tools for anyone who likes to mix and craft"). */
const SHOPS: Record<number, number[]> = {
  13: [11130, 11110, 11120, 11140, 11302, 11304, 11313, 21201, 21202, 21203, 11201, 11203, 11204, 11233, 7104, 7103, 7102, 7101, 23100, 23101, 23102],
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
export { tierWeight } from "./rules";

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
  (data.rooms as Array<{ index: number; x: number; y: number; z: number; bgs: Room["bgs"]; drops: Array<{ item: number; weight: number }>; affinity?: string; scavCost?: number }>)
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
        affinity: (r.affinity ?? "").split(",").map((a) => a.trim()).filter((a): a is Affinity => (AFFINITIES as readonly string[]).includes(a)),
        familiarSize: Math.round((r.scavCost ?? 0) / 50),
      },
    ]),
);

const EXITS: Array<[number, number]> = (data.rooms as Array<{ index: number; exits: number[] }>).flatMap((r) => r.exits.map((e) => [r.index, e] as [number, number]));

/**
 * The workbench's recipes with the source's own amounts (plan 4.5): no more squashing hundreds of pollen into a
 * handful, which made one extraction last a hundred brews. Its stamina becomes pet energy at the same ratio as a
 * move (5 stamina to 15 energy); its account XP becomes pet experience by square root, so a 10,000-XP recipe gives
 * 100 against a caring day's 27.
 */
export const craftEnergy = (stamina: number) => stamina * 3;
export const craftXp = (sourceXp: number) => Math.round(Math.sqrt(Math.max(0, sourceXp)));

export const RECIPES: Recipe[] = (data.recipes as Array<{ index: number; out: number; outAmount: number; ins: Array<{ item: number; amount: number }>; stamina: number; xp: number; tool: number | null; room: number | null }>)
  .filter((r) => RECIPE_NAMES[r.index] && ITEM[r.out] && r.ins.every((x) => ITEM[x.item]) && (r.tool === null || ITEM[r.tool]))
  .map((r) => ({
    index: r.index,
    name: RECIPE_NAMES[r.index]!,
    out: r.out,
    outAmount: Math.max(1, r.outAmount),
    ins: r.ins.map((x) => ({ item: x.item, amount: x.amount })),
    ...(r.tool !== null ? { tool: r.tool } : {}),
    energy: craftEnergy(r.stamina),
    xp: craftXp(r.xp),
    ...(r.room !== null ? { room: r.room } : {}),
  }));

/** Recipes only a trip teaches: the garden's harvest turned into mochi. */
export const TRAVEL_RECIPES: readonly Recipe[] = [
  { index: 20001, name: { en: "Pound Rice Mochi", zh: "捣米麻薯" }, out: 11130, outAmount: 2, ins: [{ item: 7201, amount: 2 }, { item: 11312, amount: 1 }], energy: 30, xp: 5 },
  { index: 20002, name: { en: "Fold Apple Jam Mochi", zh: "包苹果酱麻薯" }, out: 11120, outAmount: 2, ins: [{ item: 11313, amount: 2 }, { item: 7201, amount: 1 }], energy: 30, xp: 5 },
  { index: 20003, name: { en: "Roll Honey Mochi", zh: "滚蜂蜜麻薯" }, out: 11140, outAmount: 2, ins: [{ item: 11312, amount: 2 }, { item: 7201, amount: 1 }], energy: 30, xp: 5 },
  // taught by friends at trust level 3 (friends/residents.ts), each the thing their shelf would otherwise sell
  { index: 20004, name: { en: "Stir Moon Tonic", zh: "调月光补剂" }, out: 11004, outAmount: 1, ins: [{ item: 1121, amount: 150 }, { item: 1112, amount: 100 }], energy: 30, xp: 5 },
  { index: 20005, name: { en: "Pound Taro Mochi", zh: "捣芋泥麻薯" }, out: 11110, outAmount: 2, ins: [{ item: 7201, amount: 2 }, { item: 1201, amount: 100 }], energy: 30, xp: 5 },
  { index: 20006, name: { en: "Yonder's Lucky Tea", zh: "阿远的好运茶" }, out: 11405, outAmount: 1, ins: [{ item: 1111, amount: 100 }, { item: 1104, amount: 100 }], energy: 30, xp: 5 },
  { index: 20007, name: { en: "Double Wisdom Candy", zh: "炼大智慧糖" }, out: 11202, outAmount: 1, ins: [{ item: 11201, amount: 2 }, { item: 1103, amount: 100 }], energy: 30, xp: 5 },
  { index: 20008, name: { en: "Melt a Metal Bar", zh: "熔金属条" }, out: 1303, outAmount: 1, ins: [{ item: 1005, amount: 30 }, { item: 1015, amount: 1 }], energy: 30, xp: 5 },
  { index: 20009, name: { en: "Warm Honeydrops", zh: "捂蜜露" }, out: 11312, outAmount: 2, ins: [{ item: 11311, amount: 1 }, { item: 1011, amount: 1 }], energy: 30, xp: 5 },
  { index: 20010, name: { en: "Nurse Why's Calm Tea", zh: "小慧的安神茶" }, out: 11404, outAmount: 1, ins: [{ item: 1111, amount: 100 }, { item: 1110, amount: 50 }], energy: 30, xp: 5 },
  { index: 20011, name: { en: "Grill a Burger", zh: "烤汉堡" }, out: 11302, outAmount: 1, ins: [{ item: 7202, amount: 1 }, { item: 7201, amount: 1 }], energy: 30, xp: 5 },
  { index: 20012, name: { en: "Spin Rock Candyfloss", zh: "转棉花岩糖" }, out: 21205, outAmount: 1, ins: [{ item: 1201, amount: 150 }, { item: 1103, amount: 50 }], energy: 30, xp: 5 },
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
  decor?: { owned: string[]; placed: Array<{ id: string; x: number; y: number }>; chainHeld?: string[] };
  /** lifetime counters keyed TYPE:index (see tally.ts); `tallied` marks an older save already counted in once */
  tally?: Record<string, number>;
  tallied?: 1;
  /** named facts that happened once (a pet named, a door opened), read by FLAG conditions */
  flags?: string[];
  /** story quests and dailies (see story.ts) */
  quests?: QuestBook;
  /** trust with each resident (quest rewards; plan 4.3) */
  trust?: Record<string, number>;
  /** community-goal rewards already taken (see goals.ts) */
  goals?: GoalClaims;
  /** bonuses from items, waiting for the next look around or spar (plan 4.5) */
  buffs?: Buff;
  /** familiarity points per room, toward its next secret find (plan 4.5) */
  familiar?: Record<number, number>;
  /** friendship steps, gifts and visits (see friendship.ts) */
  friends?: FriendsState;
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
    tally: {},
    tallied: 1,
  };
}

export type WorldResult<T extends object = object> = ({ ok: true; world: WorldState } & T) | { ok: false; reason: string };

const add = (bag: Record<number, number>, item: number, n: number): Record<number, number> => {
  const next = { ...bag, [item]: (bag[item] ?? 0) + n };
  if (next[item]! <= 0) delete next[item];
  return next;
};

export const has = (w: WorldState, item: number, n = 1): boolean => (w.bag[item] ?? 0) >= n;

/**
 * The world's numbers for one pet: its Explore skills (plan 4.4) change them. The game builds these from the pet's
 * skills (@lingxi/game exploreMods); a pet with no skills gets NO_EXPLORE_MODS, which are the world's own numbers.
 */
export interface ExploreMods {
  moveEnergy: number;
  forageEnergy: number;
  /** percent chance of a second find, added to the base one in three */
  extraFind: number;
  /** percent added to the weight of rare finds (tiers 1 to 4) */
  rareBoost: number;
  /** minutes off the hour a room waits before it can be looked around again */
  forageWaitOff: number;
  walksWithFinds: number;
  stepsOff: number;
  visitCoins: number;
  /** percent chance of one more find on a trip */
  tripExtra: number;
}
export const NO_EXPLORE_MODS: ExploreMods = { moveEnergy: MOVE_ENERGY, forageEnergy: FORAGE_ENERGY, extraFind: 0, rareBoost: 0, forageWaitOff: 0, walksWithFinds: 0, stepsOff: 0, visitCoins: 0, tripExtra: 0 };

/** Drop weights with rare finds (tiers 1 to 4) made more likely, in hundredths so small weights still move. */
export function boostRare<T extends { item: number; weight: number; tier?: number }>(drops: readonly T[], pct: number): T[] {
  if (!pct) return drops.slice();
  return drops.map((d) => ({ ...d, weight: d.weight * (d.tier !== undefined && isRareTier(d.tier) ? 100 + pct : 100) }));
}

/** Walk to a neighbouring room. The caller spends the move's energy (mods.moveEnergy) from the pet. */
export function move(w: WorldState, to: number, petEnergy: number, mods: ExploreMods = NO_EXPLORE_MODS): WorldResult<{ firstVisit: boolean; coins: number }> {
  if (!ROOMS[to]) return { ok: false, reason: "noRoom" };
  if (!neighbours(w.room).includes(to)) return { ok: false, reason: "notNear" };
  if (petEnergy < mods.moveEnergy) return { ok: false, reason: "tired" };
  const firstVisit = !w.visited.includes(to);
  const coins = firstVisit ? FIRST_VISIT_COINS + mods.visitCoins : 0;
  return {
    ok: true,
    firstVisit,
    coins,
    world: bumpAll({ ...w, room: to, visited: firstVisit ? [...w.visited, to] : w.visited, coins: w.coins + coins }, [
      ["MOVE", 0, 1],
      ["VISIT", to, 1],
      ["COINS_EARNED", 0, coins],
    ]),
  };
}

const hourKey = (now: number) => Math.floor(now / 3_600_000);
/** The look-around window: an hour, shortened by Explore skills (never under 15 minutes); keys of a shorter window never equal an hour's. */
export const forageKey = (now: number, waitOff = 0): number => (waitOff ? -(Math.floor(now / (Math.max(15, 60 - waitOff) * 60_000)) * 100 + Math.max(15, 60 - waitOff)) : hourKey(now));

function roll(seed: string, room: number, hour: number, salt: number): number {
  const h = sha256(new TextEncoder().encode(`${seed}:${room}:${hour}:${salt}`));
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
}

/** Look around the current room. Once per room per window (an hour, less with skills); the caller spends mods.forageEnergy. */
export interface Familiar {
  room: number;
  points: number;
  size: number;
  /** the bar filled on this look and showed a rare find */
  filled: boolean;
}

/** How well the pet knows a room: points toward the next secret, out of the room's bar. */
export const familiarOf = (w: WorldState, room: number): { points: number; size: number } => ({ points: w.familiar?.[room] ?? 0, size: ROOMS[room]?.familiarSize ?? 0 });

export function forage(
  w: WorldState,
  now: number,
  petEnergy: number,
  mods: ExploreMods = NO_EXPLORE_MODS,
  kin: readonly Affinity[] = [],
): WorldResult<{ found: Array<{ item: number; n: number }>; familiar?: Familiar }> {
  const room = ROOMS[w.room];
  if (!room) return { ok: false, reason: "noRoom" };
  if (!room.drops.length) return { ok: false, reason: "nothingHere" };
  const hour = forageKey(now, mods.forageWaitOff);
  if (w.foraged[w.room] === hour) return { ok: false, reason: "already" };
  if (petEnergy < mods.forageEnergy) return { ok: false, reason: "tired" };
  const drops = boostRare(room.drops, mods.rareBoost);
  const pick = (salt: number) => pickDrop(drops, roll(w.seed, w.room, hour, salt));
  // a second find: the base one in three, plus the skills' percent (out of 300, so a third stays exact)
  const r99 = roll(w.seed, w.room, hour, 99);
  const second = mods.extraFind ? r99 % 300 < 100 + 3 * mods.extraFind : r99 % 3 === 0;
  // a waiting bonus (the Teardrop Jewel) adds its finds once, then is spent
  const extra = w.buffs?.forageExtra ?? 0;
  const count = 1 + (second ? 1 : 0) + extra;
  const found: Array<{ item: number; n: number }> = [];
  for (let i = 0; i < count; i++) {
    const item = pick(i);
    const f = found.find((x) => x.item === item);
    if (f) f.n += 1;
    else found.push({ item, n: 1 });
  }
  // familiarity: a full bar shows one of the room's rarest finds (tiers 1 to 4, or its rarest tier if it has none)
  let familiar: Familiar | undefined;
  let familiarMap = w.familiar;
  if (room.familiarSize > 0) {
    let points = (w.familiar?.[w.room] ?? 0) + familiarGain(room, kin);
    const filled = points >= room.familiarSize;
    if (filled) {
      points -= room.familiarSize;
      const kept = ROOM_SECRETS[w.room];
      // its rare finds, or its rarest tier where it has no rare ones
      const rarest = Math.min(...room.drops.map((d) => d.tier));
      const secrets = room.drops.filter((d) => isRareTier(d.tier) || d.tier === rarest);
      const firstTime = kept !== undefined && !(w.tally?.[`FIND:${kept}`] ?? 0);
      const item = firstTime ? kept : pickDrop(secrets, roll(w.seed, w.room, hour, 777));
      const f = found.find((x) => x.item === item);
      if (f) f.n += 1;
      else found.push({ item, n: 1 });
    }
    familiarMap = { ...(w.familiar ?? {}), [w.room]: points };
    familiar = { room: w.room, points, size: room.familiarSize, filled };
  }
  let bag = w.bag;
  for (const f of found) bag = add(bag, f.item, f.n);
  const buffs = extra ? (({ forageExtra: _spent, ...rest }) => rest)(w.buffs ?? {}) : w.buffs;
  const next = bump(
    { ...w, bag, foraged: { ...w.foraged, [w.room]: hour }, foragedCount: w.foragedCount + 1, ...(buffs ? { buffs } : {}), ...(familiarMap ? { familiar: familiarMap } : {}) },
    "FORAGE",
    w.room,
  );
  return { ok: true, found, ...(familiar ? { familiar } : {}), world: bumpFinds(next, found) };
}

export function buy(w: WorldState, item: number): WorldResult {
  const room = ROOMS[w.room];
  const def = ITEM[item];
  if (!room || !def || !room.shop.includes(item) || def.price === undefined) return { ok: false, reason: "notSold" };
  if (w.coins < def.price) return { ok: false, reason: "coins" };
  return { ok: true, world: bumpAll({ ...w, coins: w.coins - def.price, bag: add(w.bag, item, 1) }, [["BUY", item, 1], ["COINS_SPENT", 0, def.price]]) };
}

/** What stops a recipe now, the first thing in the source's order: the tool, the room, the inputs, the pet's energy. */
export function craftBlocker(w: WorldState, r: Recipe, petEnergy = Infinity): "tool" | "room" | "missing" | "tired" | null {
  if (r.tool !== undefined && !has(w, r.tool)) return "tool";
  if (r.room !== undefined && w.room !== r.room) return "room";
  if (!r.ins.every((x) => has(w, x.item, x.amount))) return "missing";
  if (petEnergy < r.energy) return "tired";
  return null;
}

/** Make a recipe. The caller spends `energy` from the pet and gives it `xp`. */
export function craft(w: WorldState, recipeIndex: number, petEnergy = Infinity): WorldResult<{ made: number; energy: number; xp: number }> {
  // a travel recipe works only once a trip has brought it home
  const r = RECIPES.find((x) => x.index === recipeIndex) ?? TRAVEL_RECIPES.find((x) => x.index === recipeIndex && (w.recipes ?? []).includes(x.index));
  if (!r) return { ok: false, reason: "noRecipe" };
  const no = craftBlocker(w, r, petEnergy);
  if (no) return { ok: false, reason: no };
  let bag = w.bag;
  for (const x of r.ins) bag = add(bag, x.item, -x.amount);
  bag = add(bag, r.out, r.outAmount);
  // one count per thing made at the bench, indexed by what came out (the source's CRAFT_ITEM, note A §1.3)
  return { ok: true, made: r.out, energy: r.energy, xp: r.xp, world: bump({ ...w, bag, crafted: w.crafted + 1 }, "CRAFT", r.out) };
}

/**
 * Take an item out of the bag to use on the pet. Returns its effect for the game rules. The source's item rules
 * hold (plan 4.5): some can only ever be used so many times, some hand back their container, and some leave a bonus
 * waiting for the next look around or spar.
 */
export function take(w: WorldState, item: number): WorldResult<{ use: NonNullable<ItemDef["use"]>; buff?: Buff }> {
  const def = ITEM[item];
  if (!def || (!def.use && !def.buff)) return { ok: false, reason: "cantUse" };
  if (!has(w, item)) return { ok: false, reason: "none" };
  if (def.limit !== undefined && usedOf(w, item) >= def.limit) return { ok: false, reason: "limit" };
  let bag = add(w.bag, item, -1);
  if (def.returns) bag = add(bag, def.returns, 1);
  const buffs = def.buff ? addBuff(w.buffs, def.buff) : w.buffs;
  return { ok: true, use: def.use ?? {}, ...(def.buff ? { buff: def.buff } : {}), world: bump({ ...w, bag, ...(buffs ? { buffs } : {}) }, "USE", item) };
}

/** How many of an item have ever been used (for the limits). */
export const usedOf = (w: WorldState, item: number): number => w.tally?.[`USE:${item}`] ?? 0;

/** Bonuses stack until they are spent. */
export function addBuff(held: Buff | undefined, more: Buff): Buff {
  const out: Buff = { ...(held ?? {}) };
  for (const [k, v] of Object.entries(more) as Array<[keyof Buff, number]>) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Spend the bonuses waiting for a spar: they are returned and cleared. */
export function spendSparBuffs(w: WorldState): { world: WorldState; power: number; hp: number; lossCoins: number } {
  const b = w.buffs ?? {};
  const { sparPower = 0, sparHp = 0, sparLossCoins = 0, ...rest } = b;
  return { world: { ...w, buffs: rest }, power: sparPower, hp: sparHp, lossCoins: sparLossCoins };
}

/**
 * Boxes open by their own tables (plan 4.5), weighted 2^(tier-1) like room finds; only items that exist in Lingxi
 * are in them. The River Box draws two or three times (the source draws once; ours is earned with more effort);
 * the Golden Box also holds five Booster Packs, as the source's does.
 */
export const BOX_TABLES: Readonly<Record<number, ReadonlyArray<{ item: number; tier: number; weight: number }>>> = Object.fromEntries(
  Object.entries((data as { boxes?: Record<string, Array<{ item: number; tier: number }>> }).boxes ?? {})
    .map(([box, rows]) => [Number(box), rows.filter((r) => ITEM[r.item]).map((r) => ({ ...r, weight: tierWeight(r.tier) }))] as const)
    .filter(([box, rows]) => ITEM[box] && rows.length),
);
const BOX_DRAWS: Readonly<Record<number, readonly [number, number]>> = { 21007: [2, 3] };
const BOX_EXTRA: Readonly<Record<number, ReadonlyArray<{ item: number; n: number }>>> = { 21008: [{ item: 21004, n: 5 }] };

/** Open a box from the bag: its draws decided by the box's own roll, so a reload cannot change them. */
export function openBox(w: WorldState, now: number, box = 21007): WorldResult<{ found: Array<{ item: number; n: number }> }> {
  const table = BOX_TABLES[box];
  if (!table) return { ok: false, reason: "notABox" };
  if (!has(w, box)) return { ok: false, reason: "none" };
  const salt = (w.bag[box] ?? 0) + w.crafted * 7 + w.foragedCount * 13;
  const [lo, hi] = BOX_DRAWS[box] ?? [1, 1];
  const n = lo + (roll(w.seed, box, hourKey(now), salt) % (hi - lo + 1));
  const found: Array<{ item: number; n: number }> = [];
  const put = (item: number, k: number) => {
    const f = found.find((x) => x.item === item);
    if (f) f.n += k;
    else found.push({ item, n: k });
  };
  for (const x of BOX_EXTRA[box] ?? []) put(x.item, x.n);
  for (let i = 0; i < n; i++) put(pickDrop(table, roll(w.seed, box, hourKey(now), salt * 31 + i)), 1);
  let bag = add(w.bag, box, -1);
  for (const f of found) bag = add(bag, f.item, f.n);
  return { ok: true, found, world: bumpFinds(bump({ ...w, bag }, "OPEN", box), found) };
}

export const earn = (w: WorldState, coins: number): WorldState => bump({ ...w, coins: w.coins + coins }, "COINS_EARNED", 0, coins);
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
