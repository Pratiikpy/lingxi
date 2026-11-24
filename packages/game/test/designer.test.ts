import { describe, expect, it } from "vitest";
import { compileProgram, gateCount } from "@lingxi/brain";
import {
  DESIGNED_PARTNERS,
  LESSON_CAPACITY,
  MAX_GATES,
  PARTNERS,
  STAGE_GATES,
  STAGE_LEVEL,
  STAGE_RULES,
  composeProgram,
  design,
  mutateProgram,
  seedProgram,
  strength,
  stream,
} from "../src/index";

const pool = [
  ...PARTNERS.map((p) => ({ name: p.id, program: p.program, level: p.level })),
  ...(["gentle", "bold", "curious"] as const).map((l) => ({ name: l, program: composeProgram(l, []), level: 0 })),
];

describe("partners designed by search", () => {
  it("a design is a pure function of its seed", () => {
    const o = {
      stage: "child" as const,
      seed: 5,
      generations: 3,
      population: 6,
      pool,
      trainSeeds: [1, 2],
      testSeeds: [3, 4],
      hallEvery: 2,
    };
    expect(design(o)).toEqual(design(o));
  });

  it("mutation keeps programs valid and small", () => {
    const rnd = stream(9);
    let p = seedProgram(rnd, 5);
    for (let i = 0; i < 2000; i++) {
      p = mutateProgram(p, rnd, 5);
      expect(p.rules.length).toBeLessThanOrEqual(5);
      expect(() => compileProgram(p)).not.toThrow();
    }
  });

  it("every shipped partner fits its stage, and its numbers reproduce", () => {
    expect(DESIGNED_PARTNERS.map((p) => p.stage)).toEqual(["baby", "child", "teen", "adult"]);
    for (const p of DESIGNED_PARTNERS) {
      const gates = gateCount(compileProgram(p.program));
      expect(gates).toBe(p.design.gates);
      expect(gates).toBeLessThanOrEqual(STAGE_GATES[p.stage as "baby"]);
      expect(p.program.rules.length).toBeLessThanOrEqual(STAGE_RULES[p.stage as "baby"]);
    }
  });

  it("every shipped partner can be beaten by a pet of its stage holding its allowed lessons", () => {
    const TEST = Array.from({ length: 24 }, (_, i) => 1009 + i * 104729);
    for (const p of DESIGNED_PARTNERS) {
      const c = p.design.counter;
      expect(c.lessons.length).toBeLessThanOrEqual(LESSON_CAPACITY[p.stage as "baby"]);
      const taught = composeProgram(c.line, c.lessons);
      expect(gateCount(compileProgram(taught))).toBeLessThanOrEqual(MAX_GATES);
      const wins = strength(
        taught,
        STAGE_LEVEL[p.stage as "baby"],
        [{ name: p.id, program: p.program, level: p.level }],
        TEST,
      );
      expect(wins).toBeCloseTo(c.wins, 3);
      expect(wins).toBeGreaterThanOrEqual(0.55);
    }
  });
});
