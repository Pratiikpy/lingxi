/**
 * G7: the gate budget as a real choice. Lessons are paid for out of a budget per stage, counted over the gates they add
 * to the pet's circuit; every Mind gate skill widens it; a lesson that does not fit says so and names what could make
 * room. The whole circuit still has to fit the on-chain limit.
 */
import { describe, expect, it } from "vitest";
import { PET_SCHOOL, SKILLS, TAUGHT_BUDGET, brainSize, checkMindLesson, lessonCost, roomMakers, taughtBudget, taughtGates } from "../src";

const school = PET_SCHOOL.map((s) => s.rule);

describe("a budget per stage, counted over taught gates (G7)", () => {
  it("grows with each stage and counts only what the lessons add", () => {
    const order = ["baby", "child", "teen", "adult", "elder"] as const;
    for (let i = 1; i < order.length; i++) expect(TAUGHT_BUDGET[order[i]!]).toBeGreaterThan(TAUGHT_BUDGET[order[i - 1]!]);
    const spec = { line: "gentle" as const, lessons: [] };
    expect(taughtGates(spec)).toBe(0);
    const one = taughtGates({ ...spec, lessons: [school[0]!] });
    expect(one).toBeGreaterThan(0);
    expect(brainSize({ ...spec, lessons: [school[0]!] }, "teen")).toMatchObject({ taught: one, taughtMax: TAUGHT_BUDGET.teen });
  });

  it("a teen with three or four school lessons meets the limit: the next is refused for size, with both numbers", () => {
    for (const line of ["gentle", "bold", "curious"] as const) {
      let lessons: (typeof school)[number][] = [];
      let refused: string | null = null;
      for (const rule of school) {
        if (lessons.length >= 4) break;
        const r = checkMindLesson({ line, lessons }, "teen", rule);
        if (!r.ok) {
          expect(r.reason).toBe("tooBig");
          refused = r.detail;
          break;
        }
        lessons = [rule, ...lessons];
      }
      expect(refused, `${line}: a teen meets its budget within four school lessons`).toMatch(new RegExp(`taught gates; a teen holds ${TAUGHT_BUDGET.teen}`));
    }
  });

  it("every Mind gate skill widens the taught budget a player sees", () => {
    const gateSkills = SKILLS.filter((s) => s.effect === "GATES");
    expect(gateSkills.map((s) => s.id).sort()).toEqual([211, 221, 233, 241, 251, 263]);
    for (const s of gateSkills) {
      const g = { level: 99, points: 0, skills: { [s.id]: 1 } };
      expect(taughtBudget("teen", g), s.name.en).toBe(TAUGHT_BUDGET.teen + s.value);
      expect(brainSize({ line: "gentle", lessons: [], growth: g }, "teen").taughtMax).toBe(TAUGHT_BUDGET.teen + s.value);
    }
  });

  it("a lesson's cost is shown against the budget before teaching, and the lessons that could make room are named", () => {
    const spec = { line: "gentle" as const, lessons: school.slice(0, 3) };
    const tooMuch = school.slice(3).find((r) => !lessonCost(spec, r, "teen").fits)!;
    expect(tooMuch, "some fourth lesson does not fit a teen").toBeTruthy();
    const c = lessonCost(spec, tooMuch, "teen");
    expect(c.taught).toBeGreaterThan(c.taughtMax);
    const makers = roomMakers(spec, tooMuch, "teen");
    expect(makers.length).toBeGreaterThan(0);
    for (const i of makers) expect(lessonCost({ ...spec, lessons: spec.lessons.filter((_, k) => k !== i) }, tooMuch, "teen").fits).toBe(true);
  });

  it("a pet already over its budget keeps every lesson; only adding one is refused", () => {
    const lessons = school.slice(0, 6);
    const spec = { line: "gentle" as const, lessons };
    expect(taughtGates(spec)).toBeGreaterThan(TAUGHT_BUDGET.teen);
    expect(brainSize(spec, "teen").taught).toBeGreaterThan(brainSize(spec, "teen").taughtMax);
    const r = checkMindLesson(spec, "elder", school[7]!);
    expect(r.ok).toBe(true);
  });
});
