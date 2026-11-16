/**
 * Going out (PRD W4, W5). A walk lasts 20 minutes on a phone: real steps,
 * counted from the device's motion sensor where it has one (minutes where it
 * does not), turn up things from the paths the pet knows. A trip sends the pet
 * away for a few hours to a far place; it comes back with things found nowhere
 * else and a recipe it learned there, which then appears at the workbench.
 * Finds are drawn from the player's seed, the day and the outing, so they do
 * not change on a reload.
 */

import { type ExploreMods, ITEM, NO_EXPLORE_MODS, ROOMS, type Recipe, TRAVEL_RECIPES, type WorldResult, type WorldState, boostRare, pickDrop } from "./world";
import { bump, bumpFinds } from "./tally";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const WALK_MINUTES = 20;
export const STEPS_PER_FIND = 400;
/** with no step sensor, a minute of walking counts as this many steps */
export const STEPS_PER_MINUTE = 100;
export const MAX_WALK_FINDS = 6;
export const WALKS_WITH_FINDS = 2;

export interface Walk {
  startedAt: number;
  steps: number;
  /** steps come from the device's motion sensor (otherwise from the clock) */
  sensor: boolean;
  finds: Array<{ item: number; n: number }>;
}

function mix(seed: string, a: number, b: number): number {
  let h = 2166136261;
  for (const c of `${seed}|${a}|${b}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 13;
  return Math.imul(h, 0x5bd1e995) >>> 0;
}

/** what a walk can turn up: everything foraged in rooms the player has visited (rare finds boosted by skills) */
function walkPool(w: WorldState, rareBoost = 0): Array<{ item: number; weight: number }> {
  const out = new Map<number, number>();
  for (const r of w.visited) for (const d of boostRare(ROOMS[r]?.drops ?? [], rareBoost)) out.set(d.item, (out.get(d.item) ?? 0) + d.weight);
  if (!out.size) for (const d of boostRare(ROOMS[1]?.drops ?? [], rareBoost)) out.set(d.item, d.weight);
  return [...out].map(([item, weight]) => ({ item, weight }));
}

const pick = pickDrop;

const dayKey = (now: number) => Math.floor(now / DAY);
const walksToday = (w: WorldState, now: number) => (w.walksDay === dayKey(now) ? (w.walksToday ?? 0) : 0);

export function startWalk(w: WorldState, now: number, sensor: boolean): WorldResult {
  if (w.walk) return { ok: false, reason: "walking" };
  if (w.trip) return { ok: false, reason: "travelling" };
  return { ok: true, world: { ...w, walk: { startedAt: now, steps: 0, sensor, finds: [] } } };
}

/** Steps so far: the sensor's count, or the clock's when there is no sensor. Capped at the walk's length. */
export function walkSteps(walk: Walk, now: number): number {
  const minutes = Math.max(0, Math.min(WALK_MINUTES, (now - walk.startedAt) / MIN));
  return walk.sensor ? walk.steps : Math.floor(minutes * STEPS_PER_MINUTE);
}

export const walkDone = (walk: Walk, now: number): boolean => now - walk.startedAt >= WALK_MINUTES * MIN;

/** Adds sensor steps (ignored without a sensor or after the walk), and collects any finds they reach. */
export function stepWalk(w: WorldState, steps: number, now: number, mods: ExploreMods = NO_EXPLORE_MODS): WorldResult<{ found: Array<{ item: number; n: number }> }> {
  const walk = w.walk;
  if (!walk) return { ok: false, reason: "notWalking" };
  // a step sensor cannot add more than a brisk walker manages: 3 steps a second
  const cap = Math.floor(((Math.min(now, walk.startedAt + WALK_MINUTES * MIN) - walk.startedAt) / 1000) * 3);
  const counted = walk.sensor ? Math.min(cap, walk.steps + Math.max(0, Math.floor(steps))) : walk.steps;
  const next = { ...walk, steps: counted };
  const total = walkSteps(next, now);
  const earned = walksToday(w, now) < WALKS_WITH_FINDS + mods.walksWithFinds ? Math.min(MAX_WALK_FINDS, Math.floor(total / Math.max(100, STEPS_PER_FIND - mods.stepsOff))) : 0;
  const have = walk.finds.reduce((t, f) => t + f.n, 0);
  const found: Array<{ item: number; n: number }> = [];
  const pool = walkPool(w, mods.rareBoost);
  for (let k = have; k < earned; k++) {
    const item = pick(pool, mix(w.seed, walk.startedAt, k));
    const f = found.find((x) => x.item === item);
    if (f) f.n++;
    else found.push({ item, n: 1 });
  }
  const finds = [...walk.finds];
  for (const f of found) {
    const g = finds.find((x) => x.item === f.item);
    if (g) finds[finds.indexOf(g)] = { ...g, n: g.n + f.n };
    else finds.push(f);
  }
  return { ok: true, found, world: { ...w, walk: { ...next, finds } } };
}

/** Ends the walk: its finds go in the bag. Returns what it came to. */
/** a walk shorter than this, with nothing found, does not use up one of the day's walks */
export const WALK_COUNTS_AFTER_MINUTES = 5;

export function endWalk(w: WorldState, now: number, mods: ExploreMods = NO_EXPLORE_MODS): WorldResult<{ steps: number; minutes: number; finds: Array<{ item: number; n: number }>; capped: boolean }> {
  const settled = stepWalk(w, 0, now, mods);
  if (!settled.ok) return settled;
  const walk = settled.world.walk!;
  let bag = settled.world.bag;
  for (const f of walk.finds) bag = { ...bag, [f.item]: (bag[f.item] ?? 0) + f.n };
  const minutes = Math.min(WALK_MINUTES, Math.round((now - walk.startedAt) / MIN));
  const day = dayKey(now);
  const capped = walksToday(w, now) >= WALKS_WITH_FINDS + mods.walksWithFinds;
  const counts = minutes >= WALK_COUNTS_AFTER_MINUTES || walk.finds.length > 0;
  const { walk: _done, ...rest } = settled.world;
  const done: WorldState = { ...rest, bag, walksDay: day, walksToday: walksToday(w, now) + (counts ? 1 : 0) };
  return { ok: true, steps: walkSteps(walk, now), minutes, finds: walk.finds, capped, world: bumpFinds(counts ? bump(done, "WALK") : done, walk.finds) };
}

/* ── trips ─────────────────────────────────────────────────────────────── */

export interface Destination {
  id: string;
  hours: number;
  name: { en: string; zh: string };
  postcard: { en: string; zh: string };
  /** hand-set weights for this destination (not rarity tiers) */
  drops: Array<{ item: number; weight: number }>;
  /** the recipe the pet brings back the first time it goes there */
  teaches: number;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "seaside",
    hours: 2,
    name: { en: "The seaside", zh: "海边" },
    postcard: { en: "The sea was very big and very wet. Brought you something shiny.", zh: "大海好大，好湿。给你带了点亮亮的东西。" },
    drops: [
      { item: 1002, weight: 6 },
      { item: 1006, weight: 3 },
      { item: 1019, weight: 2 },
      { item: 11314, weight: 3 },
    ],
    teaches: 20001,
  },
  {
    id: "orchard",
    hours: 4,
    name: { en: "The hill orchard", zh: "山坡果园" },
    postcard: { en: "Apples everywhere. I only ate some of them.", zh: "到处都是苹果。我只吃了一点点。" },
    drops: [
      { item: 11313, weight: 6 },
      { item: 11311, weight: 4 },
      { item: 7101, weight: 2 },
      { item: 1007, weight: 1 },
    ],
    teaches: 20002,
  },
  {
    id: "oldtown",
    hours: 6,
    name: { en: "The old town", zh: "老城" },
    postcard: { en: "Old streets, old coins, a very old cat who was nice to me.", zh: "老街、老钱币，还有一只很老的猫对我很好。" },
    drops: [
      { item: 1015, weight: 4 },
      { item: 1021, weight: 2 },
      { item: 1010, weight: 2 },
      { item: 11414, weight: 3 },
    ],
    teaches: 20003,
  },
];
export const DESTINATION: Readonly<Record<string, Destination>> = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));

export interface Trip {
  to: string;
  leftAt: number;
  backAt: number;
}

export function startTrip(w: WorldState, to: string, now: number): WorldResult {
  const d = DESTINATION[to];
  if (!d) return { ok: false, reason: "noPlace" };
  if (w.trip) return { ok: false, reason: "travelling" };
  if (w.walk) return { ok: false, reason: "walking" };
  return { ok: true, world: { ...w, trip: { to, leftAt: now, backAt: now + d.hours * HOUR } } };
}

export const tripBack = (t: Trip, now: number): boolean => now >= t.backAt;

/** The pet comes home: three or four finds from the place, and its recipe the first time. */
export function endTrip(w: WorldState, now: number, mods: ExploreMods = NO_EXPLORE_MODS): WorldResult<{ to: string; found: Array<{ item: number; n: number }>; learned: number | null }> {
  const t = w.trip;
  if (!t) return { ok: false, reason: "notTravelling" };
  if (!tripBack(t, now)) return { ok: false, reason: "notBack" };
  const d = DESTINATION[t.to]!;
  // Pathfinder skills: a percent chance of one more find
  const count = 3 + (mix(w.seed, t.leftAt, 99) % 2) + (mods.tripExtra && mix(w.seed, t.leftAt, 98) % 100 < mods.tripExtra ? 1 : 0);
  const found: Array<{ item: number; n: number }> = [];
  for (let k = 0; k < count; k++) {
    const item = pick(d.drops, mix(w.seed, t.leftAt, k));
    const f = found.find((x) => x.item === item);
    if (f) f.n++;
    else found.push({ item, n: 1 });
  }
  let bag = w.bag;
  for (const f of found) bag = { ...bag, [f.item]: (bag[f.item] ?? 0) + f.n };
  const known = w.recipes ?? [];
  const learned = known.includes(d.teaches) ? null : d.teaches;
  const { trip: _back, ...rest } = w;
  const home: WorldState = { ...rest, bag, recipes: learned ? [...known, learned] : known, trips: (w.trips ?? 0) + 1 };
  return { ok: true, to: t.to, found, learned, world: bumpFinds(bump(home, "TRIP", t.to), found) };
}

/** Travel recipes the player knows, ready for the workbench. */
export { TRAVEL_RECIPES };

export const knownTravelRecipes = (w: WorldState): Recipe[] => TRAVEL_RECIPES.filter((r) => (w.recipes ?? []).includes(r.index) && ITEM[r.out]);
