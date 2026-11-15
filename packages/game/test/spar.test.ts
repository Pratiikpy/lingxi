import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { PARTNERS } from "../src/partners";
import { ROUNDS, spar, type Fighter } from "../src/spar";
import { coach } from "../src/coach";
import { composeProgram } from "../src/lessons";

const fighter = (name: string, program: import("@lingxi/brain").Program, level = 0): Fighter => ({
  name,
  brain: fastBrain(compileProgram(program)),
  memory: new Array(stateBits(program)).fill(0),
  level,
});
const partner = (id: string) => {
  const p = PARTNERS.find((x) => x.id === id)!;
  return fighter(p.name.en, p.program, p.level);
};

describe("spars", () => {
  it("are deterministic for a seed and end within the round limit", () => {
    const a = spar(fighter("Mochi", STARTERS.gentle), partner("pip"), 42);
    const b = spar(fighter("Mochi", STARTERS.gentle), partner("pip"), 42);
    expect(a).toEqual(b);
    expect(a.rounds.length).toBeGreaterThan(0);
    expect(a.rounds.length).toBeLessThanOrEqual(ROUNDS);
    expect(a.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("every move comes from the pet's own circuit on that round's word", () => {
    const me = fighter("Mochi", STARTERS.bold);
    const r = spar(me, partner("plush"), 7);
    const replay = fighter("Mochi", STARTERS.bold);
    const mem = Uint8Array.from(replay.memory);
    for (const round of r.rounds) {
      const out = replay.brain.step(mem, round.words[0]);
      const want = ["tap", "snack", "pounce", "rest", "dodge", "guard", "charm", "gift"][out & 7];
      // moves only differ when an exhausted pet is forced to rest, or a pounce slips to a tap
      expect(round.moves[0] === want || round.moves[0] === "rest" || (want === "pounce" && round.moves[0] === "tap")).toBe(true);
    }
  });

  it("partners get harder in order against the same pet", () => {
    const wins = PARTNERS.map((p) => {
      let w = 0;
      for (let s = 1; s <= 40; s++) if (spar(fighter("Mochi", STARTERS.bold), partner(p.id), s).winner === 0) w++;
      return w;
    });
    expect(wins[0]).toBeGreaterThanOrEqual(wins[3]!);
  });

  it("the coach's lesson, once taught, changes the fight", () => {
    const base = fighter("Mochi", STARTERS.gentle);
    const lost = [...Array(30)].map((_, s) => spar(base, partner("pip"), s + 1)).find((r) => r.winner === 1);
    expect(lost).toBeTruthy();
    const note = coach({ result: lost!, side: 0, line: "gentle", stage: "adult", lessons: [], level: 0, opponent: partner("pip") });
    expect(note.lesson).toBeTruthy();
    expect(note.after).toBeGreaterThan(note.before);
    const taught = fighter("Mochi", composeProgram("gentle", [note.lesson!.rule]));
    const after = spar(taught, partner("pip"), lost!.seed);
    expect(after.digest).not.toBe(lost!.digest);
  });
});
