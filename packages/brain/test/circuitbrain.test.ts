import { describe, expect, it } from "vitest";
import { STARTERS, circuitBrain, compileProgram, encode, fastBrain, load, stateBits, toElements } from "../src";

describe("circuitBrain", () => {
  it("steps exactly like the compiled fast brain, beat for beat, from the taped-out bytes", () => {
    for (const p of Object.values(STARTERS)) {
      const n = compileProgram(p);
      const bytes = encode(toElements(n));
      const onChain = circuitBrain(load(bytes, 16, n.nOut));
      const local = fastBrain(n);
      const a = new Uint8Array(stateBits(p));
      const b = new Uint8Array(stateBits(p));
      let seed = 12345;
      for (let i = 0; i < 400; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const w = seed & 0xffff;
        expect(onChain.step(a, w)).toBe(local.step(b, w));
        expect(Array.from(a)).toEqual(Array.from(b));
      }
    }
  });
});
