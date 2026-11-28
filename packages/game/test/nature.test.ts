/**
 * R64: a Bold egg ("brave and greedy") read "Nature: gentle, greedy" on the Pet sheet after a few pats and its first
 * lesson. The sheet named as the pet's nature the two traits with the most drift, from a single point (of fifteen):
 * the share lesson's one nudge on meeting a friend made a Bold pet "gentle", and a curious pat at breakfast could make
 * it "curious". The egg's line is the nature it hatched with; traits are habits, and the rest of the game (the voice,
 * the visitors who want "a very gentle pet") counts one only from HABIT. natureOf says both, in that order.
 */
import { describe, expect, it } from "vitest";
import { ACTION, EVENT, HABIT, PET_SCHOOL, TRAITS, care, createPet, instinctBits, mindBrain, natureOf } from "../src";

const zero = Object.fromEntries(TRAITS.map((t) => [t, 0])) as Record<(typeof TRAITS)[number], number>;

describe("a pet's nature on its sheet (R64)", () => {
  it("is its egg's line, whatever a point or two of drift says", () => {
    expect(natureOf({ line: "bold", traits: zero })).toEqual({ line: "bold", habits: [], growing: null });
    expect(natureOf({ line: "bold", traits: { ...zero, gentle: 2, greedy: 1 } })).toEqual({
      line: "bold",
      habits: [],
      growing: "gentle",
    });
  });

  it("names a trait as a habit only from HABIT, as the voice and the visitors do, the strongest two", () => {
    const n = natureOf({ line: "bold", traits: { ...zero, gentle: HABIT, greedy: HABIT + 4, curious: HABIT + 1 } });
    expect(n).toEqual({ line: "bold", habits: ["greedy", "curious"], growing: null });
    expect(natureOf({ line: "gentle", traits: { ...zero, shy: HABIT - 1 } }).habits).toEqual([]);
  });

  it("a trait it leans to before any is a habit is the strongest, the first in TRAITS order on a tie", () => {
    expect(natureOf({ line: "curious", traits: { ...zero, shy: 1, greedy: 1 } }).growing).toBe("greedy");
  });

  it("the walk that found it: a Bold egg, patted, fed, taught to share, meeting a friend, is still Bold", () => {
    const at = Date.UTC(2026, 10, 28, 9);
    const instincts = instinctBits(["brave"]);
    const share = PET_SCHOOL[0]!.rule;
    let brain = mindBrain({ line: "bold", lessons: [], instincts });
    let p = createPet({ name: "Biscuit", line: "bold", now: at, tzOffsetMin: 0, brain, instincts });
    let t = at;
    for (let i = 0; i < 4; i++) p = care(p, { kind: "pet" }, (t += 5_000), brain).pet;
    p = care(p, { kind: "feed", food: "mochi" }, (t += 60_000), brain).pet;
    p = { ...p, lessons: [share] };
    brain = mindBrain({ line: "bold", lessons: p.lessons, instincts });
    p = care(p, { kind: "pet" }, (t += 60_000), brain, EVENT.friend).pet;
    expect(p.last.want, "it shared with the friend, as the lesson says").toBe(7);
    expect(p.traits.gentle, "the lesson nudged it gentle").toBeGreaterThan(0);
    expect(ACTION.pet).toBe(5);
    const n = natureOf(p);
    expect(n.line).toBe("bold");
    expect(n.habits).toEqual([]);
  });
});
