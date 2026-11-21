/**
 * G1's light-bulb moment (row B4): what brings a newly taught lesson about, so the pet can be seen doing it at once.
 *
 *   event    the lesson answers a friend, a toy or a noise: the game stages that event in the next live beats, as the
 *            same input word the pet's log commits to, so proofs replay it like any other beat
 *   care     the lesson answers being fed, played with, bathed and so on: the game asks the player to give that care
 *   watched  the lesson answers nothing but the owner being near on a quiet beat: it shows by itself while watched
 *   moment   the lesson waits on the time of day or a need (an afternoon, a tired or hungry or dusty pet): nothing
 *            honest can bring that about at once, so the game shows what the pet would do when it comes
 */

import { INPUT_FIELDS, type Rule, type Senses } from "@lingxi/brain";
import { EVENT } from "./sim";

/** A calm, watched daytime moment: nothing pressing, the owner here (a lesson's other senses are read as this). */
export const CALM_SENSES: Senses = { hunger: 0, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 0, owner: 1 };

/** Live beats after a lesson is taught that carry its staged event. */
export const LIGHT_BULB_BEATS = 3;

/** The care that each action number on the pins is (1 fed … 7 talked to). */
const CARE_OF_ACTION = ["", "feed", "play", "clean", "lightsOff", "pet", "medicine", "talk"] as const;
export type LessonCare = Exclude<(typeof CARE_OF_ACTION)[number], "">;

export type LessonTrigger = { kind: "event"; event: number } | { kind: "care"; care: LessonCare } | { kind: "watched" } | { kind: "moment" };

const allowed = (rule: Rule, pin: keyof Senses): readonly number[] | undefined => {
  const v = (rule.when as Record<string, number[] | undefined>)[pin];
  return v?.length ? v : undefined;
};

/** What brings a lesson about (see the header). */
export function lessonTrigger(rule: Rule): LessonTrigger {
  const event = allowed(rule, "event")?.find((e) => e !== EVENT.none);
  if (event !== undefined) return { kind: "event", event };
  const action = allowed(rule, "action")?.find((a) => a !== 0);
  if (action !== undefined) return { kind: "care", care: CARE_OF_ACTION[action] as LessonCare };
  // a sense the calm watched moment does not already satisfy (the time of day, a need) makes it a moment lesson
  for (const f of INPUT_FIELDS) {
    const v = allowed(rule, f.name as keyof Senses);
    if (v && !v.includes(CALM_SENSES[f.name as keyof Senses])) return { kind: "moment" };
  }
  return { kind: "watched" };
}

/** The situation a lesson names: every sense it names as the lesson wants it, every other one calm and watched. */
export function momentFor(rule: Rule): Senses {
  const s: Senses = { ...CALM_SENSES };
  for (const f of INPUT_FIELDS) {
    const v = allowed(rule, f.name as keyof Senses);
    if (v && !v.includes(s[f.name as keyof Senses])) s[f.name as keyof Senses] = v[0]!;
  }
  return s;
}

/** The event a live beat carries while a light bulb is staged (`from` the teaching beat), or null when none is. */
export function stagedEvent(staged: { event: number; from: number } | null | undefined, beat: number): number | null {
  return staged && beat > staged.from && beat <= staged.from + LIGHT_BULB_BEATS ? staged.event : null;
}
