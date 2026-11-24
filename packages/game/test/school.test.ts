import { describe, expect, it } from "vitest";
import { PET_SCHOOL } from "../src/lessons";
import { familyOf } from "../src/family";
import { SCHOOL_GOALS, checkGoal, levelOpen, schoolReport, trapsAfter, trapsOf } from "../src/school";

const LINES = ["gentle", "bold", "curious"] as const;
const rule = (id: string) => PET_SCHOOL.find((l) => l.id === id)!.rule;

describe("Pet School goals", () => {
  it("every level has three goals", () => {
    // eight levels, as the README says (A56)
    expect(PET_SCHOOL).toHaveLength(8);
    for (const l of PET_SCHOOL) expect(SCHOOL_GOALS[l.id], l.id).toHaveLength(3);
  });

  it("tested solutions: each lesson learned alone earns all three stars on every egg line, with or without instincts", () => {
    for (const line of LINES)
      for (const instincts of [0, 15])
        for (const l of PET_SCHOOL) {
          const r = schoolReport({ line, lessons: [l.rule], instincts }).find((x) => x.id === l.id)!;
          expect(
            r.stars,
            `${line} ${instincts} ${l.id}: ${r.goals.filter((g) => !g.met).map((g) => g.goal.say.en)}`,
          ).toBe(3);
        }
  });

  it("without the lesson, a pet does not already earn all three stars (each lesson teaches something)", () => {
    for (const line of LINES)
      for (const l of PET_SCHOOL) {
        const met = SCHOOL_GOALS[l.id]!.filter((g) => checkGoal({ line, lessons: [] }, [], g).met).length;
        expect(met, `${line} ${l.id} already meets ${met} goals untaught`).toBeLessThan(3);
      }
  });

  it("levels open one after another", () => {
    const r0 = schoolReport({ line: "gentle", lessons: [] });
    expect(levelOpen(r0, 0)).toBe(true);
    expect(levelOpen(r0, 1)).toBe(false);
    const r1 = schoolReport({ line: "gentle", lessons: [PET_SCHOOL[0]!.rule] });
    expect(levelOpen(r1, 1)).toBe(true);
  });

  it("children earn stars through the half that rules each time of day", () => {
    const fam = familyOf({ name: "A", line: "gentle", lessons: [] }, { name: "B", line: "bold", lessons: [] });
    const r = schoolReport({ line: "gentle", lessons: [rule("brave")], family: fam }).find((x) => x.id === "brave")!;
    expect(r.stars).toBe(3);
  });
});

describe("trap orders", () => {
  it("a lesson placed above another can take its stars, and the blocker is named", () => {
    // 'thanks' (fed → cuddle) above 'patient' (peckish → wait) is fine; 'greet' above 'patient' answers first when you are there
    const good = { line: "gentle" as const, lessons: [rule("patient"), rule("greet")] };
    const bad = { line: "gentle" as const, lessons: [rule("greet"), rule("patient")] };
    expect(trapsOf(good)).toEqual([]);
    const traps = trapsOf(bad);
    expect(traps.length).toBeGreaterThan(0);
    expect(traps.every((t) => t.victim === "patient")).toBe(true);
    expect(traps[0]!.blocker).toEqual(rule("greet"));
    // moving greet up from the good order is flagged before it happens
    expect(trapsAfter(good, bad.lessons).length).toBe(traps.length);
    expect(trapsAfter(bad, good.lessons)).toEqual([]);
  });
});

describe("a perfect order exists", () => {
  it("all eight lessons can earn all 24 stars on every line, and the newest-on-top order does not", () => {
    const order = ["share", "brave", "nap", "patient", "tidy", "explore", "greet", "thanks"].map(rule);
    for (const line of LINES) {
      expect(
        schoolReport({ line, lessons: order }).reduce((n, r) => n + r.stars, 0),
        line,
      ).toBe(24);
      const newestOnTop = PET_SCHOOL.map((l) => l.rule).reverse();
      expect(schoolReport({ line, lessons: newestOnTop }).reduce((n, r) => n + r.stars, 0)).toBeLessThan(24);
    }
  });
});
