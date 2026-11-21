// @vitest-environment happy-dom
/**
 * G1: why it did that. The rule that won is named for where it came from: the player's own lesson, a parent's lesson,
 * an instinct switched on at hatching, a skill, or the line it was born with.
 */
import { describe, expect, it } from "vitest";
import { type Rule, STARTERS } from "@lingxi/brain";
import { INSTINCT_RULES, type Pet, composeProgram } from "@lingxi/game";
import { ruleKindOf } from "./ruleKind";

const lesson: Rule = { when: { event: [2] }, then: { want: 7, mood: 3 } };
const pet = { line: "gentle", lessons: [lesson], instincts: 1, growth: undefined, family: undefined } as unknown as Pet;
const program = composeProgram("gentle", [lesson], 1);

describe("where the deciding rule came from (G1)", () => {
  it("names a taught lesson, an instinct, the line's own rules and its default", () => {
    expect(ruleKindOf(pet, program, 0)).toBe("taught");
    const inst = program.rules.findIndex((r) => JSON.stringify(r.when) === JSON.stringify(INSTINCT_RULES.brave.when));
    expect(inst).toBeGreaterThan(0);
    expect(ruleKindOf(pet, program, inst)).toBe("instinct");
    expect(ruleKindOf(pet, program, program.rules.length - 1)).toBe("inborn");
    expect(ruleKindOf(pet, program, -1)).toBe("inborn");
  });
  it("a child's rule from a parent's lessons is the parent's", () => {
    const parentLesson: Rule = { when: { event: [1] }, then: { want: 7, mood: 2 } };
    const child = { line: "gentle", lessons: [], family: { parents: [{ name: "A", line: "gentle", lessons: [parentLesson] }, { name: "B", line: "bold", lessons: [] }] } } as unknown as Pet;
    const p = composeProgram("gentle", [parentLesson]);
    expect(ruleKindOf(child, p, 0)).toBe("parent");
    expect(ruleKindOf(child, STARTERS.gentle, 0)).toBe("inborn");
  });
});
