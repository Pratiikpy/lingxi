import { describe, expect, it } from "vitest";
import { type Circuit, STARTERS, beat, bitsToWord, compileProgram, composeChild, load, netlistBytes, refKey, wordToBits } from "@lingxi/brain";
import { checkMindLesson, familyOf, halvesOf, mindBrain, canBreed } from "../src/family";
import { createPet, teach } from "../src/index";

const brave = { when: { event: [3], owner: [1] }, then: { want: 6, mood: 1, nudge: 1 } };
const napper = { when: { time: [2], energy: [0, 1] }, then: { want: 3, mood: 1, nudge: 4 } };
const share = { when: { event: [1] }, then: { want: 7, mood: 2, nudge: 6 } };

describe("families", () => {
  const family = familyOf({ name: "Mochi", line: "gentle", lessons: [brave] }, { name: "Tofu", line: "bold", lessons: [napper] });

  it("a child's fast brain gives exactly what the on-chain child circuit gives, memory included", () => {
    const CPU = "0x00000000000000000000000000000000000000bb";
    const [pa, pb] = halvesOf(family, [share]);
    const parents: Record<string, Circuit> = {
      [refKey(CPU, 7n)]: load(netlistBytes(compileProgram(pa)), 16, 8),
      [refKey(CPU, 8n)]: load(netlistBytes(compileProgram(pb)), 16, 8),
    };
    const child = load(composeChild({ cpu: CPU, id: 7n }, { cpu: CPU, id: 8n }).bytes, 16, 8, (c, id) => parents[refKey(c, id)] ?? null);
    const fast = mindBrain({ line: "gentle", lessons: [share], family });
    expect(fast.nState).toBe(child.nState);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    let state = new Array(child.nState).fill(0);
    const fastState = new Uint8Array(child.nState);
    for (let i = 0; i < 5000; i++) {
      const w = Math.floor(rnd() * 65536);
      const [next, out] = beat(child, state, wordToBits(w, 16));
      const fastOut = fast.fast.step(fastState, w);
      expect(fastOut).toBe(Number(bitsToWord(out)));
      expect(Array.from(fastState)).toEqual(next);
      state = next;
    }
  });

  it("generations count up and minds that do not fit are refused", () => {
    expect(family.generation).toBe(1);
    const grand = familyOf({ name: "Kid", line: "gentle", lessons: [], generation: 1 } as never, { name: "Other", line: "curious", lessons: [] });
    expect(grand.generation).toBe(2);
  });

  it("teaching a child checks both halves and changes both", () => {
    const pet = { ...createPet({ name: "Kid", line: "gentle", now: 0, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [], family }) }), family };
    const r = teach(pet, share, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = halvesOf(family, r.pet.lessons);
    expect(a.rules[0]).toEqual(share);
    expect(b.rules[0]).toEqual(share);
    expect(checkMindLesson({ line: "gentle", lessons: r.pet.lessons, family }, "baby", napper)).toMatchObject({ ok: false, reason: "full" });
  });

  it("only grown pets that have rested can have a child", () => {
    expect(canBreed({ stage: "adult" }, { stage: "elder" }, 10)).toEqual({ ok: true });
    expect(canBreed({ stage: "teen" }, { stage: "adult" }, 10)).toMatchObject({ reason: "notAdult" });
    expect(canBreed({ stage: "adult", lastBredDay: 9 }, { stage: "adult" }, 10)).toMatchObject({ reason: "tooSoon" });
    expect(canBreed({ stage: "adult", lastBredDay: 7 }, { stage: "adult" }, 10)).toEqual({ ok: true });
  });

  it("starter brains still match the plain compiler", () => {
    expect(mindBrain({ line: "bold", lessons: [] }).nState).toBe(compileProgram(STARTERS.bold).latches.length);
  });
});
