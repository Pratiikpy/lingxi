/**
 * Sizes for the device build: the largest trip packet a pet can bring (a child with an owned instinct and a full
 * mind) and how much of the core's arena the self-test and that brain use. The firmware's buffers are set from this.
 *
 *   npx tsx scripts/measure-sizes.ts
 */
import { readFileSync } from "node:fs";
import { STARTERS, bytesToHex, compileProgram, fastBrain, netlistBytes, stateBits } from "@lingxi/brain";
import { type Pet, SKILLS, createPet, familyOf } from "@lingxi/game";
import { gameCircuit, tripBrainOf, tripPacket } from "../src";

const T0 = Date.UTC(2026, 10, 17, 9);
const P = "0x00000000000000000000000000000000000000c1";
const lesson = { label: "x", when: { hunger: [3] }, then: { want: 1, mood: 1 } };
const ruleSkills = SKILLS.filter((s) => s.rule);
const full = Object.fromEntries(ruleSkills.map((s) => [s.id, 1]));
const family = familyOf(
  { name: "Ada", line: "gentle", lessons: Array(8).fill(lesson), skills: ruleSkills.map((s) => s.id), petId: 1 },
  { name: "Bo", line: "bold", lessons: Array(8).fill(lesson), skills: ruleSkills.map((s) => s.id), petId: 2 },
);
const outside = {
  processor: P,
  id: "7",
  owner: P,
  parts: [{ processor: P, id: "7", nIn: 16, nOut: 8, hex: bytesToHex(netlistBytes(compileProgram(STARTERS.bold))) }],
};
const wasm = readFileSync(new URL("../wasm/lingxi-handheld.wasm", import.meta.url));
const snacks = [1, 2, 3, 4].map((i) => ({
  id: String(11100 + i),
  count: 9,
  effect: { food: 100, joy: 20 },
  name: { en: "A long snack name here!", zh: "很长的零食名字" },
}));

for (const [label, extra] of [
  ["a starter", {}],
  [
    "a child with an owned instinct, 8 lessons (an elder's full mind), every rule skill",
    { family, outside, lessons: Array(8).fill(lesson), growth: { level: 20, points: 0, skills: full } },
  ],
] as const) {
  const base = createPet({
    name: "Pip",
    line: "gentle",
    now: T0,
    tzOffsetMin: 0,
    brain: { fast: fastBrain(compileProgram(STARTERS.gentle)), nState: stateBits(STARTERS.gentle) },
  });
  const shaped = { ...base, ...extra } as Pet;
  const t = gameCircuit(shaped);
  // the pet's memory is as wide as the brain it now runs
  const pet = { ...shaped, brain: new Array<number>(tripBrainOf(t).brain.nState).fill(0) };
  const packet = tripPacket(pet, t, snacks, {
    name: "A pet with a long name",
    line: pet.line,
    stage: 4,
    form: 0,
    colour: 0,
    lang: 0,
    bornBeat: 0,
  });
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const x = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
  x.hh_init!(0);
  const afterTest = x.hh_arena_used!();
  const peakTest = x.hh_arena_peak!();
  new Uint8Array(x.memory.buffer).set(packet, x.hh_in!());
  const e = x.hh_open!(packet.length);
  console.log(
    `${label}: packet ${packet.length} bytes, open ${e === 0 ? "ok" : `error ${e}`}, arena ${afterTest} bytes in use after the self-test (peak ${peakTest}), ${x.hh_arena_used!()} with the pet aboard (peak ${x.hh_arena_peak!()})`,
  );
}
