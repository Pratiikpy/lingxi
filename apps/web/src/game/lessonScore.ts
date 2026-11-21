/**
 * G1: each lesson keeps score. How many of today's beats each of the pet's lessons decided, from the day's log replayed
 * with the minds the pet ran (Rewind's own replay), so beats while away count as well as beats watched.
 */

import type { Rule } from "@lingxi/brain";
import { type Mind, type OutsideInstinct, type Pet, rewind } from "@lingxi/game";
import { localDay } from "@lingxi/world";

const DAY_BEATS = 24 * 60;
const same = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

/** For each of the pet's lessons, in order, the beats of the local day of `now` that it decided. */
export function firesToday(pet: Pet, mindFor: (lessons: Rule[], outside?: OutsideInstinct, skills?: number[]) => Mind, now: number): number[] {
  const today = localDay(now, pet.tzOffsetMin);
  const counts = pet.lessons.map(() => 0);
  for (const f of rewind(pet, mindFor, DAY_BEATS)) {
    if (f.at === null || localDay(f.at, pet.tzOffsetMin) !== today || f.rule < 0) continue;
    const r = f.program.rules[f.rule]!;
    const i = pet.lessons.findIndex((l) => same(l, r));
    if (i >= 0) counts[i]! += 1;
  }
  return counts;
}
