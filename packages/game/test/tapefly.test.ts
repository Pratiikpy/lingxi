import { describe, expect, it } from "vitest";
import {
  STARTERS,
  compileProgram,
  encodeFlyProgram,
  fastBrain,
  programOfChips,
  runFlyProgram,
  stateBits,
} from "@lingxi/brain";
import { FLY_RIVALS, FlyLinkError, flyFighter, parseFlyBrain } from "../src/tapeflyRivals";
import { duelWord, spar, type Fighter } from "../src/spar";

const pet = (line: keyof typeof STARTERS): Fighter => ({
  name: line,
  brain: fastBrain(compileProgram(STARTERS[line])),
  memory: new Array(stateBits(STARTERS[line])).fill(0),
  level: 1,
});
const ANSWER = ["rest", "dodge", "dodge", "guard"] as const;

describe("sparring TapeFly-format brains", () => {
  it("every ladder rival compiles to the gate count TapeFly publishes", () => {
    expect(FLY_RIVALS.map((r) => flyFighter(r.name, programOfChips(r.chips)).gates)).toEqual([
      8, 11, 21, 30, 22, 32, 21, 21,
    ]);
  });

  it("the TapeFly brain's every move is its program's answer on the DUEL pins it was shown", () => {
    for (const r of FLY_RIVALS) {
      const p = programOfChips(r.chips);
      const res = spar(pet("bold"), flyFighter(r.name, p), 77);
      for (const round of res.rounds) {
        const w = round.words[1];
        expect(w & 3).toBe(3);
        const out = runFlyProgram(p, w);
        const want: string = out & 4 ? "pounce" : ANSWER[out & 3]!;
        const made = round.moves[1];
        const stamina = round.n === 0 ? 10 : res.rounds[round.n - 1]!.stamina[1];
        const allowed = stamina <= 0 && want !== "rest" && want !== "tap" ? "rest" : want;
        expect(made === allowed || (allowed === "pounce" && made === "tap")).toBe(true);
      }
    }
  });

  it("are deterministic, and the pet side is untouched by the opponent's profile", () => {
    const fly = flyFighter("Eve", programOfChips(["punish", "block", "bite"]));
    expect(spar(pet("gentle"), fly, 5)).toEqual(spar(pet("gentle"), fly, 5));
    const r = spar(pet("gentle"), fly, 5);
    expect(r.rounds[0]!.words[0] >>> 16).toBe(0);
  });

  it("the DUEL word reports a guarding rival as a shield and a resting one as open", () => {
    const side = (last: "guard" | "rest" | "pounce" | "tap") => ({
      hp: 100,
      stamina: 10,
      maxHp: 100,
      maxStamina: 10,
      weakened: 0,
      memory: [],
      last,
      momentum: 0,
    });
    expect((duelWord(side("tap"), side("guard"), 3) >> 2) & 3).toBe(1);
    expect((duelWord(side("tap"), side("pounce"), 3) >> 2) & 3).toBe(2);
    expect((duelWord(side("tap"), side("rest"), 3) >> 2) & 3).toBe(3);
    expect((duelWord(side("tap"), side("rest"), 0) >> 2) & 3).toBe(0);
  });

  it("reads TapeFly links, p1 codes and chip lists, and refuses anything else", () => {
    const code = encodeFlyProgram(programOfChips(["block", "bite"]));
    for (const t of [
      `https://tapefly.xyz/brawl?program=${code}`,
      code,
      "https://tapefly.xyz/api/v1/brawl?chips=block,bite",
      "block, bite",
    ]) {
      const p = parseFlyBrain(t);
      for (let w = 0; w < 4096; w += 7)
        expect(runFlyProgram(p, w)).toBe(runFlyProgram(programOfChips(["block", "bite"]), w));
    }
    for (const bad of ["", "https://tapefly.xyz/brawl", "p1.###", "laser", "x".repeat(700)])
      expect(() => parseFlyBrain(bad)).toThrow(FlyLinkError);
  });
});
