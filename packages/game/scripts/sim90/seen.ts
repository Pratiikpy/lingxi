/**
 * Is a taught lesson seen? (plan G1.) For each Pet School lesson, on each egg line and at several visit hours, a
 * pet two hours old is taught the lesson the way the client teaches (`teach`, then one beat with "talk" on the
 * pins) and watched for ten minutes of live beats. Each beat's deciding rule is the brain's own answer (`last.rule`),
 * so "it fired" means the lesson's rule won that beat. Around the pet, the client's light-bulb moment (B4,
 * lightBulb.ts): a lesson answering an event has it staged in the next beats; one answering a care has the player give
 * it (at minutes 1, 4 and 7); one waiting on the time of day or a need is asked in its moment, on the taught brain.
 */

import { encodeSenses, runBeat, stateBits } from "@lingxi/brain";
import {
  FOODS,
  awayEvent,
  awaySeed,
  beatOf,
  watchEvent,
  care,
  catchUp,
  createPet,
  lessonTrigger,
  liveBeat,
  mindBrain,
  momentFor,
  PET_SCHOOL,
  stagedEvent,
  teach,
  type LessonSeen,
  type Pet,
} from "../../src";
import { MIN } from "./life";
import { DAY1, TZ } from "./players";

const LINES = ["gentle", "bold", "curious"] as const;
export const SEEN_HOURS = [8, 13, 19, 21] as const;
const WATCH = 10;

const brainOf = (p: Pet) => mindBrain({ line: p.line, lessons: p.lessons, instincts: p.instincts, growth: p.growth });

/** The care a care lesson answers, as the player gives it (a feed is the first food in the game). */
const careOf = (c: string): Parameters<typeof care>[1] =>
  c === "feed"
    ? { kind: "feed", food: FOODS[0]!.id }
    : ({ kind: c === "lightsOff" ? "lightsOff" : c } as Parameters<typeof care>[1]);

export function lessonsSeen(): LessonSeen[] {
  const out: LessonSeen[] = [];
  for (const s of PET_SCHOOL)
    for (const line of LINES)
      for (const hour of SEEN_HOURS) {
        const t = DAY1 + hour * 3_600_000;
        const born = createPet({
          name: "seen",
          line,
          now: t - 2 * 3_600_000,
          tzOffsetMin: TZ,
          brain: mindBrain({ line, lessons: [] }),
        });
        const seed = awaySeed(born);
        const before = catchUp(born, t, brainOf(born), (b) => awayEvent(seed, b));
        const taught = teach(before, s.rule, t, 0);
        if (!taught.ok) throw new Error(`a two-hour-old pet could not learn ${s.id}: ${taught.detail}`);
        let p = care(taught.pet, { kind: "talk" }, t, brainOf(taught.pet)).pet;
        const trigger = lessonTrigger(s.rule);
        if (trigger.kind === "moment") {
          // asked in its moment, on the taught brain and its memory as it is now
          const program = brainOf(p).program!;
          const r = runBeat(program, p.brain.slice(0, stateBits(program)), encodeSenses(momentFor(s.rule)));
          out.push({
            id: s.id,
            line,
            hour,
            firstFire: null,
            fires: 0,
            beats: 0,
            trigger: "moment",
            inMoment: r.rule === 0,
          });
          continue;
        }
        const staged = trigger.kind === "event" ? { event: trigger.event, from: beatOf(t) } : null;
        const CARE_AT = [1, 4, 7];
        let firstFire: number | null = null;
        let fires = 0;
        for (let m = 0; m <= WATCH; m++) {
          const at = t + m * MIN;
          if (m > 0 && trigger.kind === "care" && CARE_AT.includes(m))
            p = care(p, careOf(trigger.care), at, brainOf(p)).pet;
          else if (m > 0)
            p = liveBeat(p, at, brainOf(p), stagedEvent(staged, beatOf(at)) ?? watchEvent(seed, beatOf(at)));
          if (p.last.rule === 0 && !p.last.instinct) {
            fires++;
            firstFire ??= m;
          }
        }
        out.push({
          id: s.id,
          line,
          hour,
          firstFire,
          fires,
          beats: WATCH + 1,
          trigger: trigger.kind,
          ...(trigger.kind === "care" ? { cares: CARE_AT.length } : {}),
        });
      }
  return out;
}
