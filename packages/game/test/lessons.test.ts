import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, gateCount, stateBits } from "@lingxi/brain";
import { DAY_MS } from "../src/pet";
import { createPet } from "../src/sim";
import { LESSON_CAPACITY, MAX_GATES, PET_SCHOOL, arrangeLessons, checkLesson, composeProgram, teach } from "../src/lessons";

const T0 = Date.UTC(2026, 10, 16, 2);
const brain = { fast: fastBrain(compileProgram(STARTERS.gentle)), nState: stateBits(STARTERS.gentle) };
const pet = () => createPet({ name: "Mochi", line: "gentle", now: T0, tzOffsetMin: 480, brain });

describe("teaching", () => {
  it("every Pet School lesson is valid for every line and stays within the gate budget", () => {
    for (const line of ["gentle", "bold", "curious"] as const) {
      for (const l of PET_SCHOOL) {
        const r = checkLesson(line, "adult", [], l.rule);
        expect(r.ok, `${line}/${l.id}`).toBe(true);
      }
    }
  });

  it("a full adult brain (6 lessons) still compiles under the budget for every line", () => {
    for (const line of ["gentle", "bold", "curious"] as const) {
      const p = composeProgram(line, PET_SCHOOL.slice(0, LESSON_CAPACITY.adult).map((l) => l.rule));
      expect(gateCount(compileProgram(p))).toBeLessThanOrEqual(MAX_GATES);
    }
  });

  it("lessons outrank instincts and keep the memory layout, so memory carries over", () => {
    const p = composeProgram("gentle", [PET_SCHOOL[0]!.rule]);
    expect(p.rules[0]).toEqual(PET_SCHOOL[0]!.rule);
    expect(stateBits(p)).toBe(stateBits(STARTERS.gentle));
  });

  it("capacity grows with the stage, and duplicates are refused", () => {
    let p = pet();
    const a = teach(p, PET_SCHOOL[0]!.rule, T0);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    p = a.pet;
    expect(p.counts.lessons).toBe(1);
    const full = teach(p, PET_SCHOOL[1]!.rule, T0); // a baby holds one lesson
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toBe("full");
    const later = teach(p, PET_SCHOOL[0]!.rule, T0 + 2 * DAY_MS);
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.reason).toBe("duplicate");
    const child = teach(p, PET_SCHOOL[1]!.rule, T0 + 2 * DAY_MS);
    expect(child.ok).toBe(true);
  });

  it("refuses rules that name unknown pins or impossible values", () => {
    const bad = checkLesson("gentle", "adult", [], { when: { mood: [1] }, then: { want: 1, mood: 1 } } as never);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("invalid");
    const bad2 = checkLesson("gentle", "adult", [], { when: { hunger: [9] }, then: { want: 1, mood: 1 } });
    expect(bad2.ok).toBe(false);
  });

  it("arranges and forgets lessons without touching the original", () => {
    let p = pet();
    for (const [i, l] of PET_SCHOOL.slice(0, 2).entries()) {
      const r = teach(p, l.rule, T0 + 3 * DAY_MS + i);
      if (r.ok) p = r.pet;
    }
    const swapped = arrangeLessons(p, 1, "up");
    expect(swapped.lessons[0]).toEqual(p.lessons[1]);
    expect(arrangeLessons(p, 0, "forget").lessons).toHaveLength(1);
    expect(p.lessons).toHaveLength(2);
  });
});
