/**
 * G7: the gate budget as a real choice. Lessons are paid for out of a budget per stage, counted over the gates they add
 * to the pet's circuit; every Mind gate skill widens it; a lesson that does not fit says so and names what could make
 * room. The whole circuit still has to fit the on-chain limit.
 */
import { describe, expect, it } from "vitest";
import { PET_SCHOOL, SKILLS, TAUGHT_BUDGET, TAUGHT_SHARE, brainSize, checkMindLesson, lessonCost, roomMakers, taughtBudget, taughtGates } from "../src";
import { slow } from "./slow";

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
      // D3: a third of what it adds to the whole brain, still a number the player sees
      expect(taughtBudget("teen", g), s.name.en).toBe(TAUGHT_BUDGET.teen + Math.floor(s.value / TAUGHT_SHARE));
      expect(taughtBudget("teen", g)).toBeGreaterThan(TAUGHT_BUDGET.teen);
      expect(brainSize({ line: "gentle", lessons: [], growth: g }, "teen").taughtMax).toBe(TAUGHT_BUDGET.teen + Math.floor(s.value / TAUGHT_SHARE));
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

  it("stays a choice over every set and order (D13): with no Mind points at most half of a teen's four-lesson school sets fit, even in their cheapest order (not all, with every instinct); five points of Wide Mind fit them all", async () => {
    const sets: number[][] = [];
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++) for (let d = c + 1; d < 8; d++) sets.push([a, b, c, d]);
    const orders = (x: number[]): number[][] => (x.length <= 1 ? [x] : x.flatMap((v, i) => orders([...x.slice(0, i), ...x.slice(i + 1)]).map((o) => [v, ...o])));
    const five = { level: 99, points: 0, skills: { 211: 5 } };
    for (const line of ["gentle", "bold", "curious"] as const)
      for (const instincts of [0, 15]) {
        // a turn of the event loop between the six passes, so no stretch holds the worker past its runner's one-minute
        // wait under coverage (P7)
        await new Promise<void>((r) => setTimeout(r, 0));
        const cheapest = sets.map((set) => Math.min(...orders(set).map((o) => taughtGates({ line, instincts, lessons: o.map((i) => school[i]!) }))));
        const fit = cheapest.filter((g) => g <= taughtBudget("teen", undefined)).length;
        // a pet with every instinct pays less for a lesson (it shares the instincts' gates): not every set fits it, though
        // most do; without instincts at most half do
        if (instincts) expect(fit, `${line} ${instincts}: ${fit} of ${sets.length} fit with no Mind points`).toBeLessThan(sets.length);
        else expect(fit * 2, `${line}: ${fit} of ${sets.length} fit with no Mind points`).toBeLessThanOrEqual(sets.length);
        expect(cheapest.every((g) => g <= taughtBudget("teen", five)), `${line} ${instincts}: five points fit every set`).toBe(true);
      }
    // the elder's eight in every order (40,320 a line) are counted by the simulator (gate-budget-binds: 65, 61, 66 gates
    // against 60); here, the order taught by the school and its reverse
    for (const line of ["gentle", "bold", "curious"] as const)
      for (const o of [school, [...school].reverse()]) expect(taughtGates({ line, lessons: o })).toBeGreaterThan(TAUGHT_BUDGET.elder);
  }, slow(120_000));

  it("a pet already over its budget keeps every lesson; only adding one is refused", () => {
    const lessons = school.slice(0, 6);
    const spec = { line: "gentle" as const, lessons };
    expect(taughtGates(spec)).toBeGreaterThan(TAUGHT_BUDGET.teen);
    expect(brainSize(spec, "teen").taught).toBeGreaterThan(brainSize(spec, "teen").taughtMax);
    // an elder with two points of Wide Mind has room for a seventh (D13: with none, 60 gates hold no seven of these)
    const r = checkMindLesson({ ...spec, growth: { level: 40, points: 0, skills: { 211: 2 } } }, "elder", school[7]!);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
