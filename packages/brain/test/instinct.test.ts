import { describe, expect, it } from "vitest";
import { type Circuit, beat, bitsToWord, compileProgram, composeInstinct, load, netlistBytes, refKey, validateProgram, wordToBits } from "../src/index";
import { STARTERS } from "../src/starters";

const CPU = "0x00000000000000000000000000000000000000cc";
const circuitOf = (p: Parameters<typeof compileProgram>[0]) => load(netlistBytes(compileProgram(p)), 16, 8);

describe("an owned circuit as an everyday instinct", () => {
  it("the instinct answers when it wants something, the pet's own brain otherwise, beat for beat", () => {
    const own = STARTERS.gentle;
    // an instinct with memory: it shares when a friend is near, and stays quiet otherwise
    const inst = validateProgram({ version: "LX-PET/1", memory: [{ kind: "counter", name: "seen", bits: 2, inc: [{ event: [1] }] }], rules: [{ when: { event: [1] }, then: { want: 7, mood: 3, nudge: 6 } }, { when: { seen: [3] }, then: { want: 2, mood: 2 } }], otherwise: { want: 0, mood: 1 } });
    const subs = new Map<string, Circuit>([[refKey(CPU, 1n), circuitOf(own)], [refKey(CPU, 2n), circuitOf(inst)]]);
    const c = load(composeInstinct({ cpu: CPU, id: 1n }, { cpu: CPU, id: 2n }).bytes, 16, 8, (cpu, id) => subs.get(refKey(cpu, id)) ?? null);
    const a = subs.get(refKey(CPU, 1n))!;
    const b = subs.get(refKey(CPU, 2n))!;
    expect(c.nState).toBe(a.nState + b.nState);
    let sc = new Array(c.nState).fill(0);
    let sa = new Array(a.nState).fill(0);
    let sb = new Array(b.nState).fill(0);
    let seed = 7;
    let spoke = 0;
    for (let i = 0; i < 400; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const w = seed & 0xffff;
      const [nc, oc] = beat(c, sc, wordToBits(w, 16));
      const [na, oa] = beat(a, sa, wordToBits(w, 16));
      const [nb, ob] = beat(b, sb, wordToBits(w, 16));
      const ownWord = Number(bitsToWord(oa));
      const instWord = Number(bitsToWord(ob));
      const want = instWord & 7 ? instWord : ownWord;
      if (instWord & 7) spoke++;
      expect(Number(bitsToWord(oc))).toBe(want);
      expect(nc).toEqual([...na, ...nb]);
      [sc, sa, sb] = [nc, na, nb];
    }
    expect(spoke).toBeGreaterThan(20);
    expect(spoke).toBeLessThan(380);
  });
});
