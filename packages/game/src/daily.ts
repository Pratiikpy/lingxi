/**
 * The daily challenge (PRD F22) and where its seed comes from (PRD F19).
 *
 * Every day (UTC) has one challenge, the same for everyone: one sparring partner
 * and one seed. The seed is read from the first X Layer block of that day, a
 * block that did not exist until the day began, so nobody (us included) can
 * know the fight in advance, and anyone can check it on a block explorer.
 * Practice spars keep a private random seed; link duels use the challenge's.
 */

import { PARTNERS } from "./partners";
import { SPAR_VERSION, type SparVersion } from "./spar";
import { SPAR_V3, SPAR_V5 } from "./spar2";

import { DAY_MS } from "./pet";

/** Days since 1970 in UTC: the challenge changes at 00:00 UTC everywhere. */
export const dayIndex = (ms: number): number => Math.floor(ms / DAY_MS);

/**
 * The first day fought in the new rules, LX-SPAR/3 (Monday 23 November 2026, UTC, with the season's week 2026-W48; G2
 * and row B1). A day before it stays LX-SPAR/1, so a day is never split between two fights, whenever a device picks up
 * the new version. (LX-SPAR/2 was never used for the daily challenge.)
 */
export const SPAR_V3_FROM_DAY = dayIndex(Date.UTC(2026, 10, 23));
/**
 * The first day fought in the next rules, Tuesday 24 November 2026, UTC: LX-SPAR/5 (rows D8 and D20: the Spar skills tilt
 * and no longer decide; a tap hits for 4). LX-SPAR/4 lived one day, for practice and duels only, so the daily goes from
 * LX-SPAR/3 straight to LX-SPAR/5.
 */
export const SPAR_V5_FROM_DAY = dayIndex(Date.UTC(2026, 10, 24));
export const dailySparVersion = (day: number): SparVersion =>
  day >= SPAR_V5_FROM_DAY ? SPAR_V5 : day >= SPAR_V3_FROM_DAY ? SPAR_V3 : SPAR_VERSION;

/** The partner for a day: every partner in turn. */
export const dailyPartnerIndex = (day: number): number => ((day % PARTNERS.length) + PARTNERS.length) % PARTNERS.length;

/** The spar seed for a day, from that day's first block hash. */
export function dailySeed(day: number, blockHash: string): number {
  if (!/^0x[0-9a-fA-F]{64}$/.test(blockHash)) throw new Error("not a block hash");
  // the hash's first 32 bits, mixed with the day so the same block can never seed two days alike
  return (Number.parseInt(blockHash.slice(2, 10), 16) ^ Math.imul(day, 0x9e3779b1)) >>> 0;
}

/**
 * The first block at or after `ts` (seconds), found by interpolating between two
 * known blocks. `blockAt(n)` returns a block's timestamp in seconds. A handful of
 * reads, whatever the chain's block time.
 */
export async function firstBlockAtOrAfter(
  ts: number,
  latest: { number: number; timestamp: number },
  blockAt: (n: number) => Promise<number>,
): Promise<number> {
  if (latest.timestamp < ts) throw new Error("that time has not come yet");
  let lo = Math.max(0, latest.number - Math.ceil((latest.timestamp - ts) * 2) - 10);
  let loTs = await blockAt(lo);
  while (loTs >= ts && lo > 0) {
    // the guess was too late: step back further
    lo = Math.max(0, lo - (latest.number - lo) - 10);
    loTs = await blockAt(lo);
  }
  let hi = latest.number;
  let hiTs = latest.timestamp;
  // invariant: block lo is before ts, block hi is at or after ts
  for (let guard = 0; hi - lo > 1 && guard < 64; guard++) {
    const span = hiTs - loTs;
    const guess = span > 0 ? lo + Math.floor(((ts - loTs) / span) * (hi - lo)) : lo + 1;
    const mid = Math.min(hi - 1, Math.max(lo + 1, guess));
    const t = await blockAt(mid);
    if (t >= ts) {
      hi = mid;
      hiTs = t;
    } else {
      lo = mid;
      loTs = t;
    }
  }
  return hi;
}
