/**
 * A148: a pet not kept on chain keeps the last thirty days of its input log, not every word since it hatched. Its log
 * serves only Rewind and its diary (keeping it on chain starts the log afresh, A66), so the words before are let go,
 * with the memory where the log now starts kept, so Rewind still replays the days it keeps exactly as before.
 */
import { describe, expect, it } from "vitest";
import { STARTERS } from "@lingxi/brain";
import { GUEST_LOG_KEEP, GUEST_LOG_MAX, boundLog, createPet, mindBrain, rewind, type Mind } from "../src";

const T0 = Date.UTC(2026, 10, 1, 0);
const mindFor = (): Mind => ({ program: STARTERS.gentle });
const brain = mindBrain({ line: "gentle", lessons: [] });
/** a pet with a log of `words` input words, one a beat from beat 1,000 (Rewind replays any words the same way) */
const withLog = (words: number) => {
  const p = createPet({ name: "Mochi", line: "gentle", now: T0, tzOffsetMin: 0, brain: { fast: brain.fast, nState: brain.nState, program: STARTERS.gentle } });
  const pendingLog = Array.from({ length: words }, (_, i) => (i * 40_503 + 17) & 0xffff);
  return { ...p, pendingLog, logMarks: [[0, 1_000]] as Array<[number, number]> };
};

describe("a guest pet's input log is bounded (A148)", () => {
  it("leaves a log under the bound alone", () => {
    const p = withLog(2 * 1440);
    expect(boundLog(p, mindFor)).toBe(p);
  });

  it("past the bound keeps the last thirty days, and Rewind replays them exactly as before", () => {
    const pet = withLog(32 * 1440);
    expect(pet.pendingLog.length).toBeGreaterThan(GUEST_LOG_MAX);
    const bounded = boundLog(pet, mindFor);
    expect(bounded.pendingLog.length).toBe(GUEST_LOG_KEEP);
    expect(bounded.pendingLog).toEqual(pet.pendingLog.slice(-GUEST_LOG_KEEP));
    // the latest day and the day ten days back replay to the same moments, memory and choices
    for (const back of [0, 10 * 1440]) {
      const strip = (fs: ReturnType<typeof rewind>) => fs.map((f) => ({ want: f.want, mood: f.mood, rule: f.rule, memory: f.memory, at: f.at }));
      expect(strip(rewind(bounded, mindFor, 1440, back))).toEqual(strip(rewind(pet, mindFor, 1440, back)));
    }
  });
});
