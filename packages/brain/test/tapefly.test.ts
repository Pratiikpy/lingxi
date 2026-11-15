import { describe, expect, it } from "vitest";
import { DUEL_CHIPS, beat, bitsToWord, compileFlyProgram, decodeFlyProgram, encodeFlyProgram, flyCircuit, programOfChips, runFlyProgram, wordToBits } from "../src";

const ladder = [["berserk"], ["bite"], ["breathe", "block", "flank", "bite"], ["punish", "block", "bite", "flank", "kite"], ["punish", "block", "bite"], ["punish", "block", "berserk", "finisher", "bite", "kite"], ["breathe", "block", "finisher", "bite"], ["block", "breathe", "finisher", "bite"]];
// gate counts TapeFly publishes for its ladder rivals (/api/v1/brawl, 2026-11-15)
const published = [8, 11, 21, 30, 22, 32, 21, 21];

describe("TapeFly-format brains (DUEL-12x3/1)", () => {
  it("compile every published rival to the same gate count TapeFly reports, and agree with the rule list on all 4,096 words", () => {
    ladder.forEach((chips, i) => {
      const p = programOfChips(chips);
      const g = compileFlyProgram(p);
      expect(g.length).toBe(published[i]);
      const c = flyCircuit(g);
      for (let w = 0; w < 4096; w++) expect(Number(bitsToWord(beat(c, [], wordToBits(w, 12))[1]))).toBe(runFlyProgram(p, w));
    });
  });

  it("each chip alone matches the gate count TapeFly lists for it", () => {
    const alone: Record<string, number> = { bite: 11, punish: 8, block: 10, sidestep: 7, hop: 11, kite: 5, breathe: 9, finisher: 8, flank: 7, berserk: 8, bait: 11 };
    for (const c of DUEL_CHIPS) expect(compileFlyProgram(programOfChips([c.id])).length).toBe(alone[c.id]);
  });

  it("round-trip the p1 link code and refuse junk", () => {
    const p = programOfChips(["punish", "block", "bite"]);
    const code = encodeFlyProgram(p);
    expect(code.startsWith("p1.")).toBe(true);
    const back = decodeFlyProgram(code);
    for (let w = 0; w < 4096; w++) expect(runFlyProgram(back, w)).toBe(runFlyProgram(p, w));
    expect(() => decodeFlyProgram("p2.AAAA")).toThrow();
    expect(() => decodeFlyProgram("p1.!!")).toThrow();
    expect(() => decodeFlyProgram("p1.AQ")).toThrow();
    expect(() => programOfChips(["laser"])).toThrow();
  });
});
