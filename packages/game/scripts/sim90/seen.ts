/**
 * Is a taught lesson seen? (plan G1.) For each Pet School lesson, on each egg line and at several visit hours, a
 * pet two hours old is taught the lesson the way the client teaches (`teach`, then one beat with "talk" on the
 * pins) and watched for ten minutes of live beats. Each beat's deciding rule is the brain's own answer (`last.rule`),
 * so "it fired" means the lesson's rule won that beat. Nothing is staged around the pet: the game stages nothing
 * while it is open, and finding out whether lessons still show is the point.
 */

import { awayEvent, awaySeed, beatOf, watchEvent, care, catchUp, createPet, liveBeat, mindBrain, PET_SCHOOL, teach, type LessonSeen, type Pet } from "../../src";
import { MIN } from "./life";
import { DAY1, TZ } from "./players";

const LINES = ["gentle", "bold", "curious"] as const;
export const SEEN_HOURS = [8, 13, 19, 21] as const;
const WATCH = 10;

const brainOf = (p: Pet) => mindBrain({ line: p.line, lessons: p.lessons, instincts: p.instincts, growth: p.growth });

export function lessonsSeen(): LessonSeen[] {
  const out: LessonSeen[] = [];
  for (const s of PET_SCHOOL)
    for (const line of LINES)
      for (const hour of SEEN_HOURS) {
        const t = DAY1 + hour * 3_600_000;
        const born = createPet({ name: "seen", line, now: t - 2 * 3_600_000, tzOffsetMin: TZ, brain: mindBrain({ line, lessons: [] }) });
        const seed = awaySeed(born);
        const before = catchUp(born, t, brainOf(born), (b) => awayEvent(seed, b));
        const taught = teach(before, s.rule, t, 0);
        if (!taught.ok) throw new Error(`a two-hour-old pet could not learn ${s.id}: ${taught.detail}`);
        let p = care(taught.pet, { kind: "talk" }, t, brainOf(taught.pet)).pet;
        let firstFire: number | null = null;
        let fires = 0;
        for (let m = 0; m <= WATCH; m++) {
          if (m > 0) p = liveBeat(p, t + m * MIN, brainOf(p), watchEvent(seed, beatOf(t + m * MIN)));
          if (p.last.rule === 0 && !p.last.instinct) {
            fires++;
            firstFire ??= m;
          }
        }
        out.push({ id: s.id, line, hour, firstFire, fires, beats: WATCH + 1 });
      }
  return out;
}
