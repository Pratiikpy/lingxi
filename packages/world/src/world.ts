/**
 * The world: rooms on a grid you walk between, things to find, a shop, a
 * workbench and quests. Pure functions over a small saved state; every random
 * find is decided by a hash of (seed, room, hour), so it cannot be rerolled by
 * reloading.
 */

import type { GoalClaims } from "./goals";
import type { FriendsState } from "./friendship";
import { sha256 } from "@noble/hashes/sha2";
import { bump, bumpAll, bumpFinds, tallyOf } from "./tally";
import type { QuestBook } from "./story";
import data from "./data/world.json";
import { isRareTier, tierWeight } from "./rules";
import { type Buff, type ItemDef } from "./items";
import { ITEM, RECIPES, type Recipe, TRAVEL_RECIPES, pickDrop } from "./catalogue";
import {
  type Affinity,
  FIRST_VISIT_COINS,
  FORAGE_ENERGY,
  HOME,
  MOVE_ENERGY,
  ROOMS,
  ROOM_SECRETS,
  familiarGain,
  neighbours,
} from "./places";
export { tierWeight } from "./rules";
export {
  HOME,
  MOVE_ENERGY,
  FORAGE_ENERGY,
  FIRST_VISIT_COINS,
  type Room,
  type Affinity,
  affinitiesOf,
  ROOM_SECRETS,
  familiarGain,
  ROOMS,
  HOME_ROOM,
  roomOrHome,
  neighbours,
} from "./places";
export {
  type Item,
  type Recipe,
  ITEM,
  pickDrop,
  craftEnergy,
  craftXp,
  SMALL_BATCH_RECIPES,
  BULK_YIELD,
  RECIPES,
  TRAVEL_RECIPES,
} from "./catalogue";

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
  /** D2: the player's time zone (minutes east of UTC), saved when the day's errands are rolled, and the day's happening used */
  tz?: number;
  village?: { day: string; used: boolean };
  /** the day (UTC day number) and the rooms entered on it, for Wanderer's and Rich Finds' first-entry find (G6) */
  roomsDay?: number;
  roomsToday?: number[];
  /** G6: the day (the player's own day, D10) and how many spars have paid coins on it; after PAID_SPARS_PER_DAY they are practice */
  sparPayDay?: number;
  sparPaidToday?: number;
  /** the pet away on a trip, travel recipes it has brought back, and trips taken */
  trip?: { to: string; leftAt: number; backAt: number };
  recipes?: number[];
  trips?: number;
  /** outfit pieces owned, what each pet wears, and limited pieces the wallets hold on chain (see wardrobe.ts) */
  wardrobe?: {
    owned: string[];
    worn: Record<string, Partial<Record<"head" | "face" | "held", string>>>;
    chainHeld?: string[];
  };
  /** room and look packs the wallets bought on X Layer, as last read (plan 4.9, see extras.ts) */
  extras?: { room: number; looks: number };
  /** whole outfits kept to put on in one tap, and how many were ever saved (ids never repeat) */
  looks?: Array<{ id: string; name: string; outfit: Partial<Record<"head" | "face" | "held", string>> }>;
  looksMade?: number;
  /** the Mushroom Garden's plots (see garden.ts) */
  garden?: {
    plots: Array<{ crop: string; at: number; compost: boolean } | null>;
    harvested: number;
    /** G6: plots dug beyond the first four */ dug?: number;
  };
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

export type WorldResult<T extends object = object> =
  | ({ ok: true; world: WorldState } & T)
  | { ok: false; reason: string };

const add = (bag: Record<number, number>, item: number, n: number): Record<number, number> => {
  const left = (bag[item] ?? 0) + n;
  const next = { ...bag, [item]: left };
  if (left <= 0) delete next[item];
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
  /** percent chance that the first entry each day into a room picks up something there (Wanderer, Rich Finds; G6) */
  dayFind: number;
  /** percent chance of one more find on a trip */
  tripExtra: number;
}
export const NO_EXPLORE_MODS: ExploreMods = {
  moveEnergy: MOVE_ENERGY,
  forageEnergy: FORAGE_ENERGY,
  extraFind: 0,
  rareBoost: 0,
  forageWaitOff: 0,
  walksWithFinds: 0,
  stepsOff: 0,
  dayFind: 0,
  tripExtra: 0,
};

/** Drop weights with rare finds (tiers 1 to 4) made more likely, in hundredths so small weights still move. */
export function boostRare<T extends { item: number; weight: number; tier?: number }>(
  drops: readonly T[],
  pct: number,
): T[] {
  if (!pct) return drops.slice();
  return drops.map((d) => ({
    ...d,
    weight: d.weight * (d.tier !== undefined && isRareTier(d.tier) ? 100 + pct : 100),
  }));
}

/**
 * Walk to a neighbouring room. The caller spends the move's energy (mods.moveEnergy) from the pet. With `now`, the
 * first entry each day into a room may pick something up there (`mods.dayFind` percent; G6's Wanderer and Rich Finds).
 */
export function move(
  w: WorldState,
  to: number,
  petEnergy: number,
  mods: ExploreMods = NO_EXPLORE_MODS,
  now?: number,
): WorldResult<{ firstVisit: boolean; coins: number; found?: { item: number; n: number } }> {
  const room = ROOMS[to];
  if (!room) return { ok: false, reason: "noRoom" };
  if (!neighbours(w.room).includes(to)) return { ok: false, reason: "notNear" };
  if (petEnergy < mods.moveEnergy) return { ok: false, reason: "tired" };
  const firstVisit = !w.visited.includes(to);
  const coins = firstVisit ? FIRST_VISIT_COINS : 0;
  let next: WorldState = {
    ...w,
    room: to,
    visited: firstVisit ? [...w.visited, to] : w.visited,
    coins: w.coins + coins,
  };
  let found: { item: number; n: number } | undefined;
  if (now !== undefined) {
    const day = Math.floor(now / DAY_MS);
    const today = w.roomsDay === day ? (w.roomsToday ?? []) : [];
    if (!today.includes(to)) {
      next = { ...next, roomsDay: day, roomsToday: [...today, to] };
      if (mods.dayFind > 0 && room.drops.length && roll(w.seed, to, day, 77) % 100 < mods.dayFind) {
        found = { item: pickDrop(boostRare(room.drops, mods.rareBoost), roll(w.seed, to, day, 78)), n: 1 };
        next = bumpFinds({ ...next, bag: add(next.bag, found.item, 1) }, [found]);
      }
    }
  }
  return {
    ok: true,
    firstVisit,
    coins,
    ...(found ? { found } : {}),
    world: bumpAll(next, [
      ["MOVE", 0, 1],
      ["VISIT", to, 1],
      ["COINS_EARNED", 0, coins],
    ]),
  };
}
const DAY_MS = 24 * 3_600_000;

const hourKey = (now: number) => Math.floor(now / 3_600_000);
/** The look-around window: an hour, shortened by Explore skills (never under 15 minutes); keys of a shorter window never equal an hour's. */
export const forageKey = (now: number, waitOff = 0): number =>
  waitOff
    ? -(Math.floor(now / (Math.max(15, 60 - waitOff) * 60_000)) * 100 + Math.max(15, 60 - waitOff))
    : hourKey(now);

function roll(seed: string, room: number, hour: number, salt: number): number {
  const h = sha256(new TextEncoder().encode(`${seed}:${room}:${hour}:${salt}`));
  // a sha-256 digest is always 32 bytes, so the first four are there
  const [a = 0, b = 0, c = 0, d = 0] = h;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
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
export const familiarOf = (w: WorldState, room: number): { points: number; size: number } => ({
  points: w.familiar?.[room] ?? 0,
  size: ROOMS[room]?.familiarSize ?? 0,
});

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
  const looked = bump(
    {
      ...w,
      bag,
      foraged: { ...w.foraged, [w.room]: hour },
      foragedCount: w.foragedCount + 1,
      ...(buffs ? { buffs } : {}),
      ...(familiarMap ? { familiar: familiarMap } : {}),
    },
    "FORAGE",
    w.room,
  );
  const next = familiar?.filled ? bump(looked, "FAMILIAR", w.room) : looked;
  return { ok: true, found, ...(familiar ? { familiar } : {}), world: bumpFinds(next, found) };
}

export function buy(w: WorldState, item: number): WorldResult {
  const room = ROOMS[w.room];
  const def = ITEM[item];
  if (!room || !def || !room.shop.includes(item) || def.price === undefined) return { ok: false, reason: "notSold" };
  if (w.coins < def.price) return { ok: false, reason: "coins" };
  return {
    ok: true,
    world: bumpAll({ ...w, coins: w.coins - def.price, bag: add(w.bag, item, 1) }, [
      ["BUY", item, 1],
      ["COINS_SPENT", 0, def.price],
    ]),
  };
}

/** What stops a recipe now, the first thing in the source's order: the tool, the room, the inputs, the pet's energy. */
export function craftBlocker(
  w: WorldState,
  r: Recipe,
  petEnergy = Infinity,
): "tool" | "room" | "missing" | "tired" | null {
  if (r.tool !== undefined && !has(w, r.tool)) return "tool";
  if (r.room !== undefined && w.room !== r.room) return "room";
  if (!r.ins.every((x) => has(w, x.item, x.amount))) return "missing";
  if (petEnergy < r.energy) return "tired";
  return null;
}

/** Make a recipe. The caller spends `energy` from the pet and gives it `xp`. */
export function craft(
  w: WorldState,
  recipeIndex: number,
  petEnergy = Infinity,
): WorldResult<{ made: number; energy: number; xp: number }> {
  // a travel recipe works only once a trip has brought it home
  const r =
    RECIPES.find((x) => x.index === recipeIndex) ??
    TRAVEL_RECIPES.find((x) => x.index === recipeIndex && (w.recipes ?? []).includes(x.index));
  if (!r) return { ok: false, reason: "noRecipe" };
  const no = craftBlocker(w, r, petEnergy);
  if (no) return { ok: false, reason: no };
  let bag = w.bag;
  for (const x of r.ins) bag = add(bag, x.item, -x.amount);
  bag = add(bag, r.out, r.outAmount);
  // one count per thing made at the bench, indexed by what came out (the source's CRAFT_ITEM, note A §1.3)
  return {
    ok: true,
    made: r.out,
    energy: r.energy,
    xp: r.xp,
    world: bump({ ...w, bag, crafted: w.crafted + 1 }, "CRAFT", r.out),
  };
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
  return {
    ok: true,
    use: def.use ?? {},
    ...(def.buff ? { buff: def.buff } : {}),
    world: bump({ ...w, bag, ...(buffs ? { buffs } : {}) }, "USE", item),
  };
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
export const BOX_TABLES: Readonly<Record<number, ReadonlyArray<{ item: number; tier: number; weight: number }>>> =
  Object.fromEntries(
    Object.entries((data as { boxes?: Record<string, Array<{ item: number; tier: number }>> }).boxes ?? {})
      .map(
        ([box, rows]) =>
          [Number(box), rows.filter((r) => ITEM[r.item]).map((r) => ({ ...r, weight: tierWeight(r.tier) }))] as const,
      )
      .filter(([box, rows]) => ITEM[box] && rows.length),
  );
const BOX_DRAWS: Readonly<Record<number, readonly [number, number]>> = { 21007: [2, 3] };
const BOX_EXTRA: Readonly<Record<number, ReadonlyArray<{ item: number; n: number }>>> = {
  21008: [{ item: 21004, n: 5 }],
};

/** Open a box from the bag: its draws decided by the box's own roll, so a reload cannot change them. */
export function openBox(
  w: WorldState,
  _now: number,
  box = 21007,
): WorldResult<{ found: Array<{ item: number; n: number }> }> {
  const table = BOX_TABLES[box];
  if (!table) return { ok: false, reason: "notABox" };
  if (!has(w, box)) return { ok: false, reason: "none" };
  // D12 (plan 38's G6 addendum): what a box holds is fixed, not rolled when it is opened. The roll was keyed on the hour
  // and on what the player had crafted and found, so waiting an hour (or crafting one thing) re-rolled it. Now the nth
  // box of a kind this player opens always holds the same, whenever it is opened and whatever was done before.
  const serial = tallyOf(w, "OPEN", box);
  const [lo, hi] = BOX_DRAWS[box] ?? [1, 1];
  const n = lo + (roll(w.seed, box, serial, 0) % (hi - lo + 1));
  const found: Array<{ item: number; n: number }> = [];
  const put = (item: number, k: number) => {
    const f = found.find((x) => x.item === item);
    if (f) f.n += k;
    else found.push({ item, n: k });
  };
  for (const x of BOX_EXTRA[box] ?? []) put(x.item, x.n);
  for (let i = 0; i < n; i++) put(pickDrop(table, roll(w.seed, box, serial, 31 + i)), 1);
  let bag = add(w.bag, box, -1);
  for (const f of found) bag = add(bag, f.item, f.n);
  return { ok: true, found, world: bumpFinds(bump({ ...w, bag }, "OPEN", box), found) };
}

export const earn = (w: WorldState, coins: number): WorldState =>
  bump({ ...w, coins: w.coins + coins }, "COINS_EARNED", 0, coins);

/**
 * G6: a day's paid spars. The first PAID_SPARS_PER_DAY spars that would pay (a win, or a loss a skill or snack pays
 * for) pay their coins; after that a spar is free practice that still counts for quests, badges and the record. Spars
 * cost no energy, so without this a pet watched fighting for an hour earned about 1,000 coins.
 */
export const PAID_SPARS_PER_DAY = 3;
const SPAR_DAY_MS = 24 * 60 * 60 * 1000;
/** D10: the player's own day number (their time zone, as the dailies and the village keep it), so "more pay tomorrow"
 * means their tomorrow: at UTC midnight a UTC+8 player at 08:00 used to get three more */
const sparDay = (w: WorldState, now: number) => Math.floor((now + (w.tz ?? 0) * 60_000) / SPAR_DAY_MS);
export const paidSparsLeft = (w: WorldState, now: number): number =>
  Math.max(0, PAID_SPARS_PER_DAY - (w.sparPayDay === sparDay(w, now) ? (w.sparPaidToday ?? 0) : 0));
/** Pays a spar's coins if the day still has a paid spar left; `paid` is what was paid (0 once the day's are used). */
export function paySpar(w: WorldState, now: number, coins: number): { world: WorldState; paid: number } {
  if (coins <= 0 || paidSparsLeft(w, now) === 0) return { world: w, paid: 0 };
  const day = sparDay(w, now);
  const used = w.sparPayDay === day ? (w.sparPaidToday ?? 0) : 0;
  return { world: { ...earn(w, coins), sparPayDay: day, sparPaidToday: used + 1 }, paid: coins };
}
export const give = (w: WorldState, item: number, n = 1): WorldState => ({ ...w, bag: add(w.bag, item, n) });

import { QUESTS, type QuestView, questState } from "./quests";

/** Claim a finished quest's reward. */
export function claim(
  w: WorldState,
  id: string,
  view: Omit<QuestView, "world">,
): WorldResult<{ coins: number; items: Array<{ item: number; n: number }> }> {
  const q = QUESTS.find((x) => x.id === id);
  if (!q) return { ok: false, reason: "noQuest" };
  if (questState(q, { ...view, world: w }, w.claimed) !== "ready") return { ok: false, reason: "notReady" };
  let next = earn({ ...w, claimed: [...w.claimed, id] }, q.reward.coins);
  for (const it of q.reward.items ?? []) next = give(next, it.item, it.n);
  return { ok: true, coins: q.reward.coins, items: q.reward.items ?? [], world: next };
}
