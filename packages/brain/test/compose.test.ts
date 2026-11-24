import { describe, expect, it } from "vitest";
import { composeChild } from "../src/compose";
import { compileProgram, netlistBytes } from "../src/compile";
import { STARTERS } from "../src/starters";
import { type Circuit, beat, bitsToWord, load, refKey, wordToBits } from "../src/tap02";

const CPU = "0x00000000000000000000000000000000000000aa";
const parents: Record<string, Circuit> = {
  [refKey(CPU, 1n)]: load(netlistBytes(compileProgram(STARTERS.gentle)), 16, 8),
  [refKey(CPU, 2n)]: load(netlistBytes(compileProgram(STARTERS.bold)), 16, 8),
};
const resolve = (cpu: string, id: bigint) => parents[refKey(cpu, id)] ?? null;

describe("breeding by REF composition", () => {
  const child = composeChild({ cpu: CPU, id: 1n }, { cpu: CPU, id: 2n });
  const c = load(child.bytes, 16, 8, resolve);
  const A = parents[refKey(CPU, 1n)]!;
  const B = parents[refKey(CPU, 2n)]!;

  it("is a well-formed TapeOut circuit holding both parents' memory", () => {
    expect(c.nState).toBe(A.nState + B.nState);
    expect(c.elements.filter((e) => e.op === 2)).toHaveLength(2);
    expect(c.nGates).toBe(A.nGates + B.nGates + c.elements.filter((e) => e.op !== 2).length);
  });

  it("answers like parent A by day and parent B by night, mood from A, habit from B, on 20,000 random beats", () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    for (let i = 0; i < 20_000; i++) {
      const sa = Array.from({ length: A.nState }, () => (rnd() < 0.5 ? 1 : 0));
      const sb = Array.from({ length: B.nState }, () => (rnd() < 0.5 ? 1 : 0));
      const w = Math.floor(rnd() * 65536);
      const ins = wordToBits(w, 16);
      const [na, oa] = beat(A, sa, ins);
      const [nb, ob] = beat(B, sb, ins);
      const [nc, oc] = beat(c, [...sa, ...sb], ins);
      const time = (w >> 8) & 3;
      const fromA = time === 1 || time === 2;
      const outA = Number(bitsToWord(oa));
      const outB = Number(bitsToWord(ob));
      const want = (fromA ? outA : outB) & 7;
      const expected = want | (outA & 0b11000) | (outB & 0b11100000);
      expect(Number(bitsToWord(oc))).toBe(expected);
      expect(nc).toEqual([...na, ...nb]);
    }
  });

  it("refuses to load without the parents", () => {
    expect(() => load(child.bytes, 16, 8)).toThrow(/REF without a resolver/);
    expect(() => load(child.bytes, 16, 8, () => null)).toThrow(/registered processor/);
  });
});
