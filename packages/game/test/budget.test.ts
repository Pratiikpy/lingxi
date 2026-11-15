import { describe, expect, it } from "vitest";
import { compileProgram, gateCount } from "@lingxi/brain";
import { MAX_GATES, PET_SCHOOL, composeProgram } from "../src/lessons";
import { brainSize, lessonCost } from "../src/budget";

describe("gate budget", () => {
  it("measures the brain the pet really has", () => {
    const spec = { line: "gentle" as const, lessons: [PET_SCHOOL[0]!.rule], instincts: 1 };
    expect(brainSize(spec)).toEqual({ gates: gateCount(compileProgram(composeProgram("gentle", spec.lessons, 1))), max: MAX_GATES });
  });

  it("a lesson's cost is the real growth, and sharing logic shows as gates saved", () => {
    const nap = PET_SCHOOL.find((l) => l.id === "nap")!.rule;
    const spec = { line: "curious" as const, lessons: [PET_SCHOOL.find((l) => l.id === "explore")!.rule] };
    const c = lessonCost(spec, nap);
    expect(c.total).toBe(brainSize(spec).gates + c.adds);
    expect(c.saved).toBe(Math.max(0, c.alone - c.adds));
    expect(c.fits).toBe(true);
    // over all school lessons on top of each other, sharing must save something somewhere
    let saved = 0;
    const lessons = [] as typeof spec.lessons;
    for (const l of PET_SCHOOL) {
      saved += lessonCost({ line: "gentle", lessons }, l.rule).saved;
      lessons.unshift(l.rule);
    }
    expect(saved).toBeGreaterThan(0);
  });
});
