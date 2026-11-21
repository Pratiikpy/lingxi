/** G1: the diary credits the player. A moment a taught lesson decided is told as the lesson's doing, in both languages. */
import { describe, expect, it } from "vitest";
import { type Rule, STARTERS } from "@lingxi/brain";
import { composeProgram, tellMoment, type Frame } from "../src";

const lesson: Rule = { when: { event: [2] }, then: { want: 7, mood: 3 } };
const program = composeProgram("gentle", [lesson]);
const frame = (rule: number, want: number): Frame => ({ index: 0, at: null, senses: {} as Frame["senses"], want, mood: 2, nudge: 0, rule, program, memory: [] });

describe("the diary credits the player (G1)", () => {
  it("tells a taught moment as the lesson's doing", () => {
    expect(tellMoment(frame(0, 7), "en")).toBe("Because you taught me, I wanted to share with a friend.");
    expect(tellMoment(frame(0, 7), "zh")).toBe("因为你教过我，我想和朋友分享。");
  });
  it("tells a moment its own nature decided plainly", () => {
    const born = program.rules.length - 1;
    expect(tellMoment(frame(born, program.rules[born]!.then.want), "en")).not.toMatch(/taught/);
    expect(tellMoment({ ...frame(-1, 0), program: STARTERS.gentle }, "zh")).not.toMatch(/教/);
  });
});
