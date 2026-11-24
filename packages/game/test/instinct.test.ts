import { describe, expect, it } from "vitest";
import {
  compileProgram,
  composeInstinct,
  encode,
  fastBrain,
  netlistBytes,
  stateBits,
  toElements,
  validateProgram,
} from "@lingxi/brain";
import { checkMindLesson, composeProgram, mindBrain, parseCard, petCard, type OutsideInstinct } from "../src/index";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const CPU = "0x00000000000000000000000000000000000000cc";
const OWNER = "0x00000000000000000000000000000000000000dd";
const instProgram = validateProgram({
  version: "LX-PET/1",
  memory: [{ kind: "flag", name: "met", set: [{ event: [1] }] }],
  rules: [
    { when: { met: [1], time: [0] }, then: { want: 6, mood: 3 } },
    { when: { event: [3] }, then: { want: 4, mood: 0 } },
  ],
  otherwise: { want: 0, mood: 1 },
});
const outside: OutsideInstinct = {
  processor: CPU,
  id: "9",
  owner: OWNER,
  parts: [{ processor: CPU, id: "9", nIn: 16, nOut: 8, hex: hex(netlistBytes(compileProgram(instProgram))) }],
};

describe("a pet's mind with an owned instinct", () => {
  it("answers as the instinct when it wants something, as the pet otherwise, with both memories", () => {
    const spec = { line: "bold" as const, lessons: [], outside };
    const mind = mindBrain(spec);
    const own = composeProgram("bold", []);
    const ownFast = fastBrain(compileProgram(own));
    const instFast = fastBrain(compileProgram(instProgram));
    expect(mind.nState).toBe(stateBits(own) + stateBits(instProgram));
    expect(mind.instinct?.from).toBe(stateBits(own));
    const sm = new Uint8Array(mind.nState);
    const so = new Uint8Array(stateBits(own));
    const si = new Uint8Array(stateBits(instProgram));
    let seed = 11;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const w = seed & 0xffff;
      const oo = ownFast.step(so, w);
      const oi = instFast.step(si, w);
      expect(mind.fast.step(sm, w)).toBe(oi & 7 ? oi : oo);
    }
  });

  it("travels in the pet's card and is checked when read back", () => {
    const card = petCard({ lessons: [], outside });
    expect(parseCard(card)?.outside).toEqual(outside);
    // bytes that do not make a pet-shaped circuit, or a bad address, spoil the whole card
    expect(
      parseCard(JSON.stringify({ lessons: [], outside: { ...outside, parts: [{ ...outside.parts[0], hex: "zz" }] } })),
    ).toBeNull();
    expect(parseCard(JSON.stringify({ lessons: [], outside: { ...outside, processor: "nope" } }))).toBeNull();
    expect(
      parseCard(JSON.stringify({ lessons: [], outside: { ...outside, parts: [{ ...outside.parts[0], nOut: 3 }] } })),
    ).toBeNull();
  });

  it("a lesson that would push the memory past 64 bits with the instinct is refused", () => {
    // 48 + 48 memory bits: a circuit that REFs two full-memory brains
    const big = validateProgram({
      version: "LX-PET/1",
      memory: Array.from({ length: 12 }, (_, i) => ({
        kind: "counter" as const,
        name: `c${i}`,
        bits: 4,
        inc: [{ event: [1] }],
      })),
      rules: [],
      otherwise: { want: 0, mood: 1 },
    });
    const bigHex = hex(encode(toElements(compileProgram(big))));
    const wrapper = hex(composeInstinct({ cpu: CPU, id: 10n }, { cpu: CPU, id: 11n }).bytes);
    const heavy: OutsideInstinct = {
      ...outside,
      parts: [
        { processor: CPU, id: "9", nIn: 16, nOut: 8, hex: wrapper },
        { processor: CPU, id: "10", nIn: 16, nOut: 8, hex: bigHex },
        { processor: CPU, id: "11", nIn: 16, nOut: 8, hex: bigHex },
      ],
    };
    const r = checkMindLesson({ line: "gentle", lessons: [], outside: heavy }, "adult", {
      when: { event: [2] },
      then: { want: 2, mood: 2 },
    });
    expect(r).toMatchObject({ ok: false, reason: "tooBig" });
    expect(
      checkMindLesson({ line: "gentle", lessons: [], outside }, "adult", {
        when: { event: [2] },
        then: { want: 2, mood: 2 },
      }).ok,
    ).toBe(true);
  });
});
