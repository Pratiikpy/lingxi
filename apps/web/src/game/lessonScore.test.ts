// @vitest-environment happy-dom
/**
 * G1: each lesson keeps score. How many of today's beats each lesson decided, counted by replaying the day's log with
 * the minds the pet ran (Rewind), so beats while away count as well as beats watched.
 */
import { describe, expect, it } from "vitest";
import { type Rule } from "@lingxi/brain";
import { EVENT, type Pet, composeProgram, createPet, liveBeat, mindBrain, teach } from "@lingxi/game";
import { firesToday } from "./lessonScore";

const T0 = Date.UTC(2026, 10, 18, 2);
const MIN = 60_000;
const toyShare: Rule = { when: { event: [2] }, then: { want: 7, mood: 3 } };
const mindFor = (pet: Pet) => (lessons: Rule[]) => ({ program: composeProgram(pet.line, lessons) });

describe("a lesson's score for today (G1)", () => {
  it("counts the beats today that the lesson decided, and none for a lesson that never met its moment", () => {
    let p = createPet({ name: "Pip", line: "gentle", now: T0, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [] }) });
    const taught = teach(p, toyShare, T0 + MIN, 0);
    if (!taught.ok) throw new Error(taught.detail);
    p = taught.pet;
    const brain = mindBrain({ line: "gentle", lessons: [toyShare] });
    // ten watched minutes, a toy on three of them
    for (let m = 2; m < 12; m++) p = liveBeat(p, T0 + m * MIN, brain, m % 3 === 0 ? EVENT.toy : EVENT.none);
    const scores = firesToday(p, mindFor(p), T0 + 12 * MIN);
    expect(scores.map((x) => x.count)).toEqual([3]);
    // the last of them is kept whole, so it can be shown again (B4): the toy of minute 9, and what it chose
    expect(scores[0]!.last?.at).toBe(T0 + 9 * MIN);
    expect(scores[0]!.last?.senses.event).toBe(EVENT.toy);
    expect(scores[0]!.last?.want).toBe(7);
    // the same pet asked about tomorrow: nothing yet
    expect(firesToday(p, mindFor(p), T0 + 24 * 60 * MIN)).toEqual([{ count: 0, last: null }]);
  });
});
