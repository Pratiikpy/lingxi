// @vitest-environment happy-dom
/**
 * H5: the "try it" moment. Right after a lesson, the game stages the lesson's situation on the pet's real mind (its
 * memory as it is, nothing changed) and shows what it does, and which rule did it.
 */
import { describe, expect, it } from "vitest";
import { type Rule, STARTERS, stateBits } from "@lingxi/brain";
import { composeProgram } from "@lingxi/game";
import { stageFor, tryLesson } from "./tryIt";

const toyPlay: Rule = { when: { event: [2] }, then: { want: 7, mood: 3 } };
const program = composeProgram("gentle", [toyPlay]);
const fresh = new Array<number>(stateBits(program)).fill(0);

describe("trying a lesson out (H5)", () => {
  it("stages the lesson's own situation: the senses it names, everything else calm and watched", () => {
    expect(stageFor(toyPlay)).toMatchObject({ event: 2, owner: 1, hunger: 0 });
    expect(stageFor({ when: { hunger: [2, 3] }, then: { want: 1, mood: 1 } }).hunger).toBe(2);
  });

  it("the pet does what it was taught, and the rule that decided is the lesson", () => {
    const t = tryLesson(program, fresh, toyPlay);
    expect(t).toMatchObject({ fired: true, want: 7, rule: 0 });
  });

  it("a lesson that waits on a memory it does not have yet says so instead of pretending", () => {
    const needsTrust: Rule = { when: { event: [1], trust: [6, 7] }, then: { want: 6, mood: 2 } };
    const p = composeProgram("gentle", [needsTrust]);
    const t = tryLesson(p, new Array<number>(stateBits(p)).fill(0), needsTrust);
    expect(t.fired).toBe(false);
    expect(t.rule).not.toBe(0);
  });

  it("an untaught starter is never credited to a lesson", () => {
    const t = tryLesson(STARTERS.gentle, new Array<number>(stateBits(STARTERS.gentle)).fill(0), toyPlay);
    expect(t.fired).toBe(false);
  });
});
