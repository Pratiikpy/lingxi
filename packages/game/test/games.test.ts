import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { afterSwaps, care, createPet, nextPattern, seasonOf, shuffles, starsFor } from "../src/index";

describe("mini-games", () => {
  it("seasons rotate by month, flipped in the south", () => {
    expect(seasonOf(new Date(2026, 3, 1))).toBe("spring");
    expect(seasonOf(new Date(2026, 6, 1))).toBe("summer");
    expect(seasonOf(new Date(2026, 9, 1))).toBe("autumn");
    expect(seasonOf(new Date(2026, 11, 1))).toBe("winter");
    expect(seasonOf(new Date(2026, 11, 1), true)).toBe("summer");
  });
  it("stars follow thresholds", () => {
    expect([0, 3, 7, 11].map((s) => starsFor("catch", s))).toEqual([0, 1, 2, 3]);
    expect([1, 2, 4, 6].map((s) => starsFor("pattern", s))).toEqual([0, 1, 2, 3]);
  });
  it("patterns grow by one deterministic step; swaps track the hidden pet", () => {
    const a = nextPattern(nextPattern([], 5), 5);
    expect(a).toHaveLength(2);
    expect(nextPattern([], 5)).toEqual(nextPattern([], 5));
    const sw = shuffles(2, 42);
    expect(sw).toHaveLength(7);
    for (const [x, y] of sw) expect(x).not.toBe(y);
    let at = 1;
    for (const [x, y] of sw) at = at === x ? y : at === y ? x : at;
    expect(afterSwaps(1, sw)).toBe(at);
  });
  it("patterns are not a guessable cycle and use every pad", () => {
    let cycles = 0;
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      let s: number[] = [];
      for (let i = 0; i < 8; i++) s = nextPattern(s, seed);
      s.forEach((x) => seen.add(x));
      const cyc = s.every((x, i) => x === (s[0]! + i) % 4) || s.every((x, i) => x === (s[0]! - i + 8) % 4);
      if (cyc) cycles++;
      for (const x of s) expect(x).toBeLessThan(4);
    }
    expect(seen.size).toBe(4);
    expect(cycles).toBeLessThan(3);
  });

  it("stars make play more cheering", () => {
    const p = STARTERS.gentle;
    const brain = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
    const pet = createPet({ name: "M", line: "gentle", now: 0, tzOffsetMin: 0, brain });
    const zero = care(pet, { kind: "play" }, 60_000, brain).pet;
    const three = care(pet, { kind: "play", stars: 3 }, 60_000, brain).pet;
    expect(three.meters.joy).toBeGreaterThan(zero.meters.joy);
    expect(three.xp).toBeGreaterThan(zero.xp);
  });
});
