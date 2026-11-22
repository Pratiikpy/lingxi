/**
 * Surprises while you are away (PRD U4, after Neko Atsume): while the game is
 * closed, small things happen around the pet (a friend wanders by, a toy rolls
 * into reach, something startles it) and its own brain decides what to do about
 * each. They are senses like any other, so they are logged, replayed in the
 * diary and the rewind, and checked on chain like every other thought. Nothing
 * bad comes of being away: no event can hurt the pet.
 *
 * Which beats bring an event is fixed by the pet (its birth time) and the beat,
 * so the same absence always brings the same surprises, on any device.
 */

import { EVENT } from "./sim";
import { NEED_FLOOR, toVisible } from "./pet";
import type { Pet } from "./sim";

/** Chance per minute, out of 10,000: a friend about every 4 hours, a toy every 5, a fright about once a day. */
const ODDS = { friend: 42, toy: 33, scary: 7 } as const;

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** The event (if any) on a beat while the owner is away. */
export function awayEvent(petSeed: number, beat: number): number {
  const roll = mix(petSeed | 0, beat) % 10_000;
  if (roll < ODDS.friend) return EVENT.friend;
  if (roll < ODDS.friend + ODDS.toy) return EVENT.toy;
  if (roll < ODDS.friend + ODDS.toy + ODDS.scary) return EVENT.scary;
  return EVENT.none;
}

/**
 * Events while the owner watches (G1): a living room, so a lesson about a friend, a toy or a fright has something to
 * answer while the player is there to see it. Chance per minute, out of 10,000: a toy about every 12 minutes, a friend
 * about every 17, a noise about every hour; never two within WATCH_GAP minutes. Fixed by the pet and the beat, like the
 * away events, so a visit brings the same events on any device and the chain's replay of the day sees the same words.
 */
const WATCH_ODDS = { friend: 600, toy: 800, scary: 160 } as const;
export const WATCH_GAP = 3;

const watchRoll = (petSeed: number, beat: number) => mix((petSeed ^ 0x5bd1e995) | 0, beat) % 10_000;
const rolled = (roll: number) => roll < WATCH_ODDS.friend + WATCH_ODDS.toy + WATCH_ODDS.scary;

/** The event (if any) on a beat while the owner watches. */
export function watchEvent(petSeed: number, beat: number): number {
  const roll = watchRoll(petSeed, beat);
  if (!rolled(roll)) return EVENT.none;
  // a quiet few minutes after each event: none if any of the beats just before rolled one
  for (let k = 1; k <= WATCH_GAP; k++) if (rolled(watchRoll(petSeed, beat - k))) return EVENT.none;
  if (roll < WATCH_ODDS.friend) return EVENT.friend;
  if (roll < WATCH_ODDS.friend + WATCH_ODDS.toy) return EVENT.toy;
  return EVENT.scary;
}

/** A pet's seed for away surprises: its birth time, folded to 32 bits. */
export const awaySeed = (p: { bornAt: number }): number => (Math.floor(p.bornAt / 1000) ^ Math.floor(p.bornAt / 4_294_967_296_000)) >>> 0;

/** At least this long away before anything is found to bring back. */
export const FIND_AFTER_MS = 2 * 3_600_000;

/** What the pet found while you were away: one item from its home room's finds, picked by the absence. */
export function awayFind(petSeed: number, fromBeat: number, toBeat: number, drops: ReadonlyArray<{ item: number; weight: number }>): number | null {
  if ((toBeat - fromBeat) * 60_000 < FIND_AFTER_MS || drops.length === 0) return null;
  const total = drops.reduce((n, d) => n + d.weight, 0);
  if (total <= 0) return null;
  let r = mix(petSeed ^ toBeat, fromBeat) % total;
  for (const d of drops) {
    if (r < d.weight) return d.item;
    r -= d.weight;
  }
  return drops[drops.length - 1]!.item;
}

/**
 * How the pet's needs held up while its owner was away (G5), for the welcome-back card: well; waiting at the quarter
 * floor (and which ones); ill after days without care; or in a long sleep because its food ran out. Hibernation is told
 * first: a pet asleep from hunger needs waking before anything else.
 */
export function awayNeeds(p: Pick<Pet, "meters" | "sick" | "hibernating">): { kind: "fine" | "waiting" | "sick" | "hibernating"; low: Array<"food" | "joy" | "energy" | "clean"> } {
  const low = (["food", "joy", "energy", "clean"] as const).filter((k) => toVisible(p.meters[k]) <= NEED_FLOOR);
  if (p.hibernating) return { kind: "hibernating", low };
  if (p.sick) return { kind: "sick", low };
  return { kind: low.length ? "waiting" : "fine", low };
}
