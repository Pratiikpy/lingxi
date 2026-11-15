import { describe, expect, it } from "vitest";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { composeProgram } from "../src/lessons";
import { nameFromBrain } from "../src/names";

const bytes = (line: "gentle" | "bold" | "curious", instincts = 0) => netlistBytes(compileProgram(composeProgram(line, [], instincts)));

describe("names from the brain", () => {
  it("the same circuit always gives the same name, a different circuit a different one", () => {
    expect(nameFromBrain(bytes("gentle"))).toEqual(nameFromBrain(bytes("gentle")));
    const names = new Set<string>();
    for (const line of ["gentle", "bold", "curious"] as const) for (let i = 0; i < 16; i++) names.add(nameFromBrain(bytes(line, i)).en);
    expect(names.size).toBeGreaterThan(30);
  });

  it("each draw gives another name, short, in both languages", () => {
    const b = bytes("curious", 4);
    const draws = Array.from({ length: 12 }, (_, k) => nameFromBrain(b, k));
    expect(new Set(draws.map((d) => d.en)).size).toBeGreaterThan(8);
    for (const d of draws) {
      expect(d.en).toMatch(/^[A-Z][a-z]{2,8}$/);
      expect([...d.zh]).toHaveLength(2);
      expect(d.from).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });
});
