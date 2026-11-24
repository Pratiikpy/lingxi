/**
 * The three mini-games (PRD C3). Two are always there; the third changes with the
 * season, the way Uni's arcade rotates. Rules here are pure so they can be tested;
 * the screens live in the app.
 */

import { worldSeasonAt } from "./worldSeason";

export type Season = "spring" | "summer" | "autumn" | "winter";
export type GameId = "catch" | "pattern" | "seasonal";

/** Season from the month in the player's own hemisphere (north by default). */
export function seasonOf(date: Date, south = false): Season {
  const m = date.getMonth();
  const north: Season =
    m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
  if (!south) return north;
  return ({ spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" } as const)[north];
}

/**
 * D11: the rotating game follows the world's own season (worldSeason.ts, four 28-day seasons), so the home screen's
 * "Blossom Weeks" and the game's dress never disagree: Blossom Weeks are spring, Lantern Weeks summer (lantern nights at
 * the shore), Harvest Weeks autumn, Frost Weeks winter. `seasonOf` (the calendar) is kept for anything that means it.
 */
export function gameSeasonAt(ms: number): Season {
  return ({ blossom: "spring", lantern: "summer", harvest: "autumn", frost: "winter" } as const)[worldSeasonAt(ms).id];
}

/** The rotating game's theme: same rules (find the hidden pet), different dress. */
export const SEASONAL: Record<Season, { en: string; zh: string; hideIn: { en: string; zh: string } }> = {
  spring: { en: "Petal Hide-and-Seek", zh: "花瓣捉迷藏", hideIn: { en: "flower bushes", zh: "花丛" } },
  summer: { en: "Shell Game at the Shore", zh: "海边猜贝壳", hideIn: { en: "seashells", zh: "贝壳" } },
  autumn: { en: "Leaf Pile Seek", zh: "落叶堆寻宝", hideIn: { en: "leaf piles", zh: "落叶堆" } },
  winter: { en: "Snow Mound Seek", zh: "雪堆找找看", hideIn: { en: "snow mounds", zh: "雪堆" } },
};

/** Stars from a score: thresholds per game. */
export function starsFor(game: GameId, score: number): number {
  const t = game === "catch" ? [3, 7, 11] : game === "pattern" ? [2, 4, 6] : [1, 2, 3];
  return t.filter((x) => score >= x).length;
}

/** Simon-style pattern: the next sequence, one step longer, from a seeded generator. */
export function nextPattern(seq: readonly number[], seed: number, pads = 4): number[] {
  // a full avalanche mix (murmur3 finaliser) of the seed and the step, so the order is not guessable
  let h = (seed ^ Math.imul(seq.length + 1, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return [...seq, (h >>> 0) % pads];
}

/** Shell game: a list of swaps (pairs of cup indexes), more and faster each round. */
export function shuffles(round: number, seed: number, cups = 3): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = seed >>> 0 || 1;
  const n = 3 + round * 2;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const a = s % cups;
    const b = (a + 1 + ((s >>> 8) % (cups - 1))) % cups;
    out.push([a, b]);
  }
  return out;
}

/** Where the hidden pet ends up after the swaps. */
export function afterSwaps(start: number, swaps: ReadonlyArray<[number, number]>): number {
  let at = start;
  for (const [a, b] of swaps) at = at === a ? b : at === b ? a : at;
  return at;
}
