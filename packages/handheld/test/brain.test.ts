import { describe, expect, it } from "vitest";
import { STARTERS, bytesToHex, compileProgram, fastBrain, netlistBytes, stateBits } from "@lingxi/brain";
import { type Brain, type Pet, SKILLS, care, catchUp, composeProgram, createPet, familyOf, mindBrain, skillRules } from "@lingxi/game";
import { LOCAL, gameCircuit, sameMind, tripBrainOf } from "../src/brain";

const T0 = Date.UTC(2026, 10, 17, 9);
const P = "0x00000000000000000000000000000000000000c1";
const lesson = { label: "eat when hungry", when: { hunger: [3] }, then: { want: 1, mood: 1 } };
const ruleSkill = SKILLS.find((s) => s.rule)!;
const outside = {
  processor: P,
  id: "7",
  owner: P,
  parts: [{ processor: P, id: "7", nIn: 16, nOut: 8, hex: bytesToHex(netlistBytes(compileProgram(STARTERS.bold))) }],
};
const family = familyOf({ name: "Ada", line: "gentle", lessons: [lesson], skills: [ruleSkill.id], petId: 1 }, { name: "Bo", line: "bold", lessons: [], petId: 2 });

/** The game's own brain for a pet, exactly as the web store's brainOf picks it. */
function gameBrain(p: Pet): Brain {
  if (p.family || p.outside) return mindBrain({ line: p.line, lessons: p.lessons ?? [], family: p.family, instincts: p.instincts, outside: p.outside, growth: p.growth });
  const rules = skillRules(p.growth);
  const prog = p.lessons?.length || p.instincts || rules.length ? composeProgram(p.line, p.lessons ?? [], p.instincts ?? 0, { rules }) : STARTERS[p.line];
  return { fast: fastBrain(compileProgram(prog)), nState: stateBits(prog) };
}

/** A pet that has lived a while, so its memory is not all zeros. */
function lived(p: Pet): Pet {
  const b = gameBrain(p);
  let q = catchUp({ ...p, brain: new Array(b.nState).fill(0) }, T0 + 95 * 60_000, b);
  q = care(q, { kind: "feed", food: { food: 200 } }, T0 + 95 * 60_000, b).pet;
  return q;
}

const base = (extra: Partial<Pet> = {}): Pet => ({ ...createPet({ name: "Pip", line: "gentle", now: T0, tzOffsetMin: 0, brain: gameBrain({ ...createPet({ name: "x", line: "gentle", now: T0, tzOffsetMin: 0, brain: { fast: fastBrain(compileProgram(STARTERS.gentle)), nState: stateBits(STARTERS.gentle) } }), ...extra } as Pet) }), ...extra });

const PETS: Array<[string, Pet]> = [
  ["a starter", base()],
  ["a starter with a lesson and an instinct", base({ lessons: [lesson], instincts: 1 })],
  ["a pet with a rule skill", base({ growth: { level: 3, points: 0, skills: { [ruleSkill.id]: 1 } } })],
  ["a child of two parents", base({ family })],
  ["a pet with an owned instinct", base({ outside })],
  ["a child with an owned instinct", base({ family, outside, lessons: [lesson] })],
];

describe("the brain that travels (plan 4.14)", () => {
  for (const [name, p] of PETS) {
    it(`${name}: the travelling circuit thinks exactly as the game, on every input`, async () => {
      const pet = lived(p);
      const trip = gameCircuit(pet);
      const { brain } = tripBrainOf(trip);
      expect(brain.nState).toBe(gameBrain(pet).nState);
      expect(await sameMind(gameBrain(pet), brain, pet.brain)).toBe(true);
    }, 60_000);
  }

  it("local circuits are filed under the address no processor has", () => {
    const t = gameCircuit(base({ family, outside }));
    expect(t.processor).toBe(LOCAL);
    expect(t.parts.filter((q) => q.processor !== LOCAL).map((q) => q.processor)).toEqual([P]);
  });

  it("another pet's circuit is refused", async () => {
    const pet = lived(base());
    const other = tripBrainOf(gameCircuit(base({ line: "bold" } as Partial<Pet>))).brain;
    expect(await sameMind(gameBrain(pet), other, pet.brain)).toBe(false);
  });

  it("a circuit with a missing REF part cannot be loaded", () => {
    const t = gameCircuit(base({ family }));
    expect(() => tripBrainOf({ ...t, parts: t.parts.slice(1) })).toThrow();
  });
});
