/**
 * G1: each lesson keeps score. How many of today's beats each of the pet's lessons decided, from the day's log replayed
 * with the minds the pet ran (Rewind's own replay), so beats while away count as well as beats watched; and the last of
 * them, kept whole, so the moment can be shown again (B4).
 */

import type { Rule } from "@lingxi/brain";
import { type Frame, type Mind, type OutsideInstinct, type Pet, rewind } from "@lingxi/game";
import { localDay } from "@lingxi/world";

const DAY_BEATS = 24 * 60;
const same = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

/** A lesson's score today: how many beats it decided, and the last of them. */
export interface LessonScore {
  count: number;
  last: Frame | null;
}

/** For each of the pet's lessons, in order, the beats of the local day of `now` that it decided. */
export function firesToday(
  pet: Pet,
  mindFor: (lessons: Rule[], outside?: OutsideInstinct, skills?: number[]) => Mind,
  now: number,
): LessonScore[] {
  const today = localDay(now, pet.tzOffsetMin);
  const scores: LessonScore[] = pet.lessons.map(() => ({ count: 0, last: null }));
  for (const f of rewind(pet, mindFor, DAY_BEATS)) {
    if (f.at === null || localDay(f.at, pet.tzOffsetMin) !== today || f.rule < 0) continue;
    const r = f.program.rules[f.rule]!;
    const i = pet.lessons.findIndex((l) => same(l, r));
    if (i >= 0) scores[i] = { count: scores[i]!.count + 1, last: f };
  }
  return scores;
}
