/**
 * The player's lifetime counters (plan 4.1), after the source's generic counters (note A §1.3): one number per
 * `TYPE:index`, where index 0 is the total over every index. Nothing ever resets them; a quest that should count
 * only from now takes a snapshot when it is accepted (conditions.ts). The world's own actions bump them inside
 * their rules; the game bumps the pet's events (care, lessons, spars, saves) through the same function.
 */

import type { WorldState } from "./world";

/** What an index may be: an item or room number, or a word (a resident, an action, a crop). 0 means the total. */
export type TallyIndex = number | string;

export const tallyKey = (type: string, index: TallyIndex = 0): string => `${type}:${index}`;

/** The counter's value; a counter never bumped reads 0. */
export const tallyOf = (w: Pick<WorldState, "tally">, type: string, index: TallyIndex = 0): number =>
  w.tally?.[tallyKey(type, index)] ?? 0;

/**
 * Add `n` to TYPE:index and to the TYPE:0 total. A new world is returned; `n` must be a whole number above 0.
 * `total: false` leaves the total alone, for a finer counter of an event already counted (GIVE_TO resident:item).
 */
export function bump(
  w: WorldState,
  type: string,
  index: TallyIndex = 0,
  n = 1,
  opts: { total?: boolean } = {},
): WorldState {
  if (!Number.isInteger(n) || n <= 0) return w;
  const t = { ...(w.tally ?? {}) };
  const total = tallyKey(type, 0);
  if (opts.total !== false) t[total] = (t[total] ?? 0) + n;
  if (index !== 0 && index !== "0" && index !== "") {
    const k = tallyKey(type, index);
    t[k] = (t[k] ?? 0) + n;
  }
  return { ...w, tally: t };
}

/** Several bumps at once, in order. */
export const bumpAll = (
  w: WorldState,
  entries: ReadonlyArray<readonly [type: string, index: TallyIndex, n: number]>,
): WorldState => entries.reduce((acc, [type, index, n]) => bump(acc, type, index, n), w);

/** Finds from any source (looking around, walks, trips, the river box, the garden) count as FIND per item. */
export const bumpFinds = (w: WorldState, found: ReadonlyArray<{ item: number; n: number }>): WorldState =>
  bumpAll(
    w,
    found.map((f) => ["FIND", f.item, f.n] as const),
  );

/**
 * What an older save already records, counted once into the tally when it is first loaded. Only totals can be
 * recovered (a save never kept which item was found where), so per-index counters start from the moment of the
 * upgrade. `ledger` is the badge ledger, the player's lifetime care across every pet.
 */
export interface BackfillLedger {
  feed?: number;
  play?: number;
  clean?: number;
  petting?: number;
  medicine?: number;
  lessons?: number;
  sparWins?: number;
  gifts?: number;
  chainDays?: number;
}

export function backfillTally(w: WorldState, ledger: BackfillLedger): WorldState {
  if (w.tallied) return w;
  const pairs: Array<readonly [string, TallyIndex, number]> = [
    ["MOVE", 0, Math.max(0, w.visited.length - 1)],
    ["FORAGE", 0, w.foragedCount],
    ["CRAFT", 0, w.crafted],
    ["TRIP", 0, w.trips ?? 0],
    ["HARVEST", 0, w.garden?.harvested ?? 0],
    ["CARE", "feed", ledger.feed ?? 0],
    ["CARE", "play", ledger.play ?? 0],
    ["CARE", "clean", ledger.clean ?? 0],
    ["CARE", "pet", ledger.petting ?? 0],
    ["CARE", "medicine", ledger.medicine ?? 0],
    ["LESSON", 0, ledger.lessons ?? 0],
    ["SPAR_WIN", 0, ledger.sparWins ?? 0],
    ["GIFT", 0, ledger.gifts ?? 0],
    ["SAVE", 0, ledger.chainDays ?? 0],
  ];
  // whatever the tally already holds stays: the upgrade only adds what it is missing
  let next: WorldState = w;
  for (const [type, index, n] of pairs) {
    const have = tallyOf(next, type, index);
    if (n > have) next = index === 0 ? bump(next, type, 0, n - have) : bump(next, type, index, n - have);
  }
  return { ...next, tallied: 1 };
}

/** Record a named fact that happened (a pet named on chain, a door opened), read by FLAG conditions. Set once. */
export function withFlag(w: WorldState, name: string): WorldState {
  if (!/^[a-z0-9-]{1,32}$/.test(name) || (w.flags ?? []).includes(name)) return w;
  return { ...w, flags: [...(w.flags ?? []), name] };
}
