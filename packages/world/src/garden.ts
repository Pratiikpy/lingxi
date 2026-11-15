/**
 * The garden (PRD W2) and compost (C4). Cleaning up after a messy pet makes
 * compost; seeds bought at the market are planted in the Mushroom Garden's four
 * plots and grow on the real clock; compost halves the wait and adds one to the
 * harvest. What grows feeds the pet's diet, and diet steers how it evolves.
 */

import type { WorldResult, WorldState } from "./world";

export const GARDEN_ROOM = 76;
export const PLOTS = 4;
export const COMPOST = 7001;
const HOUR = 3_600_000;

export interface Crop {
  id: string;
  seed: number;
  yields: number;
  amount: number;
  hours: number;
  name: { en: string; zh: string };
}

export const CROPS: readonly Crop[] = [
  { id: "clover", seed: 7104, yields: 11312, amount: 3, hours: 4, name: { en: "Honey clover", zh: "蜜三叶草" } },
  { id: "pepper", seed: 7103, yields: 7202, amount: 2, hours: 5, name: { en: "Garden pepper", zh: "园子辣椒" } },
  { id: "rice", seed: 7102, yields: 7201, amount: 3, hours: 6, name: { en: "Rice", zh: "稻子" } },
  { id: "apple", seed: 7101, yields: 11313, amount: 2, hours: 8, name: { en: "Golden apple tree", zh: "金苹果树" } },
];
export const CROP: Readonly<Record<string, Crop>> = Object.fromEntries(CROPS.map((c) => [c.id, c]));

export interface Plot {
  crop: string;
  at: number;
  compost: boolean;
}

export type Garden = Array<Plot | null>;

export const gardenOf = (w: WorldState): Garden => {
  const g = w.garden?.plots ?? [];
  return Array.from({ length: PLOTS }, (_, i) => g[i] ?? null);
};

/** How long a plot takes, and where it is now: 0 bare, 1 sprout, 2 leafy, 3 ripe. */
export function plotStage(p: Plot | null, now: number): { stage: 0 | 1 | 2 | 3; readyAt: number | null } {
  if (!p) return { stage: 0, readyAt: null };
  const c = CROP[p.crop];
  if (!c) return { stage: 0, readyAt: null };
  const grow = (c.hours * HOUR) / (p.compost ? 2 : 1);
  const t = Math.max(0, now - p.at) / grow;
  return { stage: t >= 1 ? 3 : t >= 1 / 3 ? 2 : 1, readyAt: p.at + grow };
}

const bagAdd = (bag: Record<number, number>, item: number, n: number) => {
  const next = { ...bag, [item]: (bag[item] ?? 0) + n };
  if (next[item]! <= 0) delete next[item];
  return next;
};

export function plant(w: WorldState, plot: number, crop: string, withCompost: boolean, now: number): WorldResult {
  if (w.room !== GARDEN_ROOM) return { ok: false, reason: "notHere" };
  if (!Number.isInteger(plot) || plot < 0 || plot >= PLOTS) return { ok: false, reason: "noPlot" };
  const c = CROP[crop];
  if (!c) return { ok: false, reason: "noCrop" };
  const g = gardenOf(w);
  if (g[plot]) return { ok: false, reason: "taken" };
  if ((w.bag[c.seed] ?? 0) < 1) return { ok: false, reason: "noSeed" };
  if (withCompost && (w.bag[COMPOST] ?? 0) < 1) return { ok: false, reason: "noCompost" };
  let bag = bagAdd(w.bag, c.seed, -1);
  if (withCompost) bag = bagAdd(bag, COMPOST, -1);
  const plots = g.map((p, i) => (i === plot ? { crop, at: now, compost: withCompost } : p));
  return { ok: true, world: { ...w, bag, garden: { plots, harvested: w.garden?.harvested ?? 0 } } };
}

export function harvest(w: WorldState, plot: number, now: number): WorldResult<{ item: number; n: number }> {
  if (w.room !== GARDEN_ROOM) return { ok: false, reason: "notHere" };
  const g = gardenOf(w);
  const p = g[plot];
  if (!p) return { ok: false, reason: "empty" };
  if (plotStage(p, now).stage !== 3) return { ok: false, reason: "notRipe" };
  const c = CROP[p.crop]!;
  const n = c.amount + (p.compost ? 1 : 0);
  const plots = g.map((x, i) => (i === plot ? null : x));
  return { ok: true, item: c.yields, n, world: { ...w, bag: bagAdd(w.bag, c.yields, n), garden: { plots, harvested: (w.garden?.harvested ?? 0) + 1 } } };
}

/** Cleaning a messy pet (clean meter under half) leaves one bag of compost. */
export const COMPOST_BELOW = 500;
export function compostFromClean(w: WorldState, cleanBefore: number): { world: WorldState; made: boolean } {
  if (cleanBefore >= COMPOST_BELOW) return { world: w, made: false };
  return { world: { ...w, bag: bagAdd(w.bag, COMPOST, 1) }, made: true };
}
