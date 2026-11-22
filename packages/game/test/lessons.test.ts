import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, gateCount, stateBits } from "@lingxi/brain";
import { DAY_MS } from "../src/pet";
import { createPet } from "../src/sim";
import { LESSON_CAPACITY, MAX_GATES, PET_SCHOOL, arrangeLessons, checkLesson, composeProgram, logSegments, teach } from "../src/lessons";
import { catchUp } from "../src/sim";
import { runBeat } from "@lingxi/brain";

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

  it("a baby holds the school's first and any one of its own, within slots and its taught budget, on every line (D7)", async () => {
    const { TAUGHT_BUDGET } = await import("../src/skills");
    expect(LESSON_CAPACITY.baby).toBe(2);
    expect(TAUGHT_BUDGET.child).toBeGreaterThanOrEqual(TAUGHT_BUDGET.baby);
    for (const line of ["gentle", "bold", "curious"] as const) {
      for (const own of PET_SCHOOL.slice(1)) {
        const r = checkLesson(line, "baby", [PET_SCHOOL[0]!.rule], own.rule);
        expect(r.ok, `${line}/${own.id}: ${JSON.stringify(r)}`).toBe(true);
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
    const dup = teach(p, PET_SCHOOL[0]!.rule, T0);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe("duplicate");
    // D7: a baby holds two, the school's first and one of its own
    const b = teach(p, PET_SCHOOL[1]!.rule, T0);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    p = b.pet;
    const full = teach(p, PET_SCHOOL[2]!.rule, T0);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toBe("full");
    const teen = teach(p, PET_SCHOOL[2]!.rule, T0 + 6 * DAY_MS);
    expect(teen.ok, JSON.stringify(teen)).toBe(true);
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

describe("a log that spans lessons", () => {
  it("replays brain by brain to the pet's memory", () => {
    let p = pet();
    p = catchUp(p, T0 + 3 * DAY_MS, brain);
    const r = teach(p, PET_SCHOOL[0]!.rule, T0 + 3 * DAY_MS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    p = r.pet;
    const taught = composeProgram("gentle", p.lessons);
    const b2 = { fast: fastBrain(compileProgram(taught)), nState: stateBits(taught), program: taught };
    p = catchUp(p, T0 + 3 * DAY_MS + 4 * 3_600_000, b2);
    const segs = logSegments(p);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.words.length + segs[1]!.words.length).toBe(p.pendingLog.length);
    let state = new Array(stateBits(taught)).fill(0);
    for (const s of segs) {
      const prog = composeProgram("gentle", s.lessons);
      for (const w of s.words) state = runBeat(prog, state, w).state;
    }
    expect(state).toEqual(p.brain);
  });
});
