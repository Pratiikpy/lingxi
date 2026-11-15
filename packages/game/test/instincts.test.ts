import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, decodeOutput, encodeSenses, fastBrain, gateCount, runBeat, stateBits } from "@lingxi/brain";
import { INSTINCTS, INSTINCT_RULES, MAX_GATES, PET_SCHOOL, cleanInstincts, composeProgram, instinctBits, instinctsOf } from "../src/lessons";
import { familyOf, halvesOf, mindBrain, parseCard, petCard } from "../src/family";
import { decodeGift, encodeGift } from "../src/gift";

const calmSenses = { hunger: 0, joy: 2, energy: 2, clean: 2, time: 1, action: 0, event: 0, owner: 1 };
const decide = (instincts: number, senses: Partial<typeof calmSenses>, lessons = [] as typeof PET_SCHOOL[number]["rule"][]) => {
  const p = composeProgram("gentle", lessons, instincts);
  return decodeOutput(runBeat(p, new Array(stateBits(p)).fill(0), encodeSenses({ ...calmSenses, ...senses })).out);
};

describe("instinct switches", () => {
  it("round-trips the four bits and ignores anything else", () => {
    expect(instinctBits(["brave", "calm"])).toBe(9);
    expect(instinctsOf(9)).toEqual(["brave", "calm"]);
    expect(instinctsOf(15)).toEqual([...INSTINCTS]);
    for (const bad of [-1, 16, 2.5, "3", null, undefined]) expect(cleanInstincts(bad)).toBe(0);
  });

  it("with no switches the brain is exactly the egg line's starter brain", () => {
    expect(composeProgram("bold", [], 0)).toEqual(composeProgram("bold", []));
    expect(composeProgram("bold", []).rules).toEqual(STARTERS.bold.rules);
  });

  it("each switch changes what the pet does in its own situation", () => {
    // brave: a gentle pet faces the scary thing instead of sulking
    expect(decide(0, { event: 3 }).want).toBe(5);
    expect(decide(1, { event: 3 })).toMatchObject({ want: 4, nudge: 1 });
    // greedy: asks for food while only peckish
    expect(decide(2, { hunger: 1 })).toMatchObject({ want: 1, nudge: 3 });
    // curious: a toy is something to investigate
    expect(decide(4, { event: 2 })).toMatchObject({ want: 4, nudge: 2 });
    // calm: being dirty is no reason to sulk
    expect(decide(0, { clean: 0 }).want).toBe(5);
    expect(decide(8, { clean: 0 })).toMatchObject({ want: 0, nudge: 4 });
  });

  it("what the owner teaches still outranks an instinct", () => {
    const brave = PET_SCHOOL.find((l) => l.id === "brave")!.rule;
    expect(decide(1, { event: 3, owner: 1 }, [brave])).toMatchObject({ want: 6, nudge: 1 });
  });

  it("the compiled circuit agrees with the rule reading for every switch setting", () => {
    for (let bits = 0; bits < 16; bits++) {
      const p = composeProgram("curious", [], bits);
      const fast = fastBrain(compileProgram(p));
      for (const senses of [{ event: 3 }, { hunger: 1 }, { event: 2 }, { clean: 0 }, {}]) {
        const word = encodeSenses({ ...calmSenses, ...senses });
        const zero = new Array(stateBits(p)).fill(0);
        expect(fast.step(new Uint8Array(zero), word), `bits ${bits} ${JSON.stringify(senses)}`).toBe(runBeat(p, zero, word).out);
      }
    }
  });

  it("a full elder brain with all four switches still fits the gate budget on every line", () => {
    const lessons = PET_SCHOOL.map((l) => l.rule).slice(0, 8);
    for (const line of ["gentle", "bold", "curious"] as const) {
      const gates = gateCount(compileProgram(composeProgram(line, lessons, 15)));
      expect(gates, line).toBeLessThanOrEqual(MAX_GATES);
    }
  });

  it("instincts travel in pet cards and live on in each parent's half of a child", () => {
    const card = parseCard(petCard({ lessons: [], instincts: 5 }));
    expect(card?.instincts).toBe(5);
    expect(parseCard(JSON.stringify({ lessons: [], instincts: 99 }))?.instincts).toBeUndefined();
    const fam = familyOf({ name: "A", line: "gentle", lessons: [], instincts: 1 }, { name: "B", line: "bold", lessons: [], instincts: 8 });
    const [a, b] = halvesOf(fam, []);
    expect(a.rules[0]).toEqual(INSTINCT_RULES.brave);
    expect(b.rules[0]).toEqual(INSTINCT_RULES.calm);
    expect(parseCard(petCard({ lessons: [], family: fam }))?.family?.parents[1].instincts).toBe(8);
  });

  it("the cached brain is keyed by instincts, so two pets never share the wrong brain", () => {
    const plain = mindBrain({ line: "gentle", lessons: [] });
    const brave = mindBrain({ line: "gentle", lessons: [], instincts: 1 });
    expect(plain).not.toBe(brave);
    expect(brave.program?.rules[0]).toEqual(INSTINCT_RULES.brave);
  });

  it("a gifted egg must leave room for all four switches", () => {
    const egg = { line: "bold", lessons: PET_SCHOOL.map((l) => l.rule).slice(0, 8) };
    const code = encodeGift({ id: "abcd1234", from: { name: "A", line: "gentle", stage: "adult" }, letter: "", at: 0, egg } as never);
    expect(decodeGift(code).egg?.lessons).toHaveLength(8);
  });
});
