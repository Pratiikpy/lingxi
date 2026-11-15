/**
 * Evolution. When a pet reaches adulthood, its adult form is chosen by one
 * public circuit from how it was raised: what it ate, how it was cared for, its
 * strongest trait, how much it was taught and how much it trusts its owner.
 * Every pet uses the same circuit, taped out once, so anyone can check why a pet
 * became what it became.
 *
 * The circuit reuses the 16-pin layout of a pet brain (one compiler, one set of
 * proofs), with the pins carrying evolution inputs instead (LX-EVO/1):
 *   hunger (2 bits)  main diet       0 sweet · 1 fruit · 2 savory · 3 grain
 *   joy    (2 bits)  care quality    0 neglected · 1 some · 2 good · 3 devoted
 *   energy (2 bits)  trust           0..3 (the brain's trust memory, halved)
 *   clean  (2 bits)  lessons         0 none · 1 one or two · 2 three or four · 3 five or more
 *   action (3 bits)  strongest trait 0 none · 1 brave · 2 curious · 3 greedy · 4 calm · 5 playful · 6 gentle · 7 shy
 *   time, event, owner               unused, held at 0
 * Outputs: want = adult form (0-4), mood = rarity (0 common, 1 rare).
 */

import { type Program, compileProgram, encodeSenses, fastBrain, runBeat, validateProgram } from "@lingxi/brain";
import { DIETS, TRAITS, dayOf } from "./pet";
import type { Pet } from "./sim";

export const EVOLUTION: Program = validateProgram({
  version: "LX-PET/1",
  memory: [],
  rules: [
    { label: "rare: devoted, trusted, well taught and gentle at heart", when: { clean: [3], energy: [3], joy: [2, 3], action: [4, 6] }, then: { want: 4, mood: 1 } },
    { label: "scholar: taught a lot, brave or curious", when: { clean: [2, 3], action: [1, 2] }, then: { want: 3, mood: 0 } },
    { label: "blossom: fruit-fed and soft-natured", when: { hunger: [1], action: [4, 6, 7] }, then: { want: 1, mood: 0 } },
    { label: "dumpling: hearty food and a big appetite for fun", when: { hunger: [2, 3], action: [3, 5] }, then: { want: 2, mood: 0 } },
    { label: "sweet tooth turns playful", when: { hunger: [0], action: [5] }, then: { want: 2, mood: 0 } },
  ],
  otherwise: { want: 0, mood: 0 },
});

export const FORMS = ["puff", "blossom", "dumpling", "scholar", "moonpetal"] as const;
export type Form = (typeof FORMS)[number];

export const FORM_NAMES: Record<Form, { en: string; zh: string; how: { en: string; zh: string } }> = {
  puff: { en: "Puff", zh: "团团", how: { en: "the shape every pet can grow into", zh: "每只宠物都能长成的样子" } },
  blossom: { en: "Blossom", zh: "花苞", how: { en: "mostly fruit, and a calm, gentle or shy heart", zh: "多吃水果，性格温和、沉稳或害羞" } },
  dumpling: { en: "Dumpling", zh: "包子", how: { en: "hearty food and a greedy or playful streak", zh: "吃得实在，又馋又爱玩" } },
  scholar: { en: "Scholar", zh: "学者", how: { en: "three or more lessons, and brave or curious", zh: "学了三课以上，又勇敢或好奇" } },
  moonpetal: { en: "Moonpetal", zh: "月瓣", how: { en: "rare: devoted care, full trust, five lessons, a calm or gentle heart", zh: "稀有：悉心照顾、完全信任、学满五课、心地沉稳或温柔" } },
};

const argmax = <T extends string>(keys: readonly T[], score: (k: T) => number): T =>
  keys.reduce((best, k) => (score(k) > score(best) ? k : best), keys[keys.length - 1]!);

export interface EvolutionInputs {
  diet: number;
  care: number;
  trust: number;
  lessons: number;
  trait: number;
}

/** What the evolution circuit reads from a pet, computed only from its saved state. */
export function evolutionInputs(p: Pet, now: number, trustBits: readonly number[] = p.brain.slice(0, 3)): EvolutionInputs {
  const days = Math.max(1, dayOf(p, now));
  const diet = DIETS.indexOf(argmax(DIETS, (d) => p.diet[d]));
  const cares = p.counts.feed + p.counts.play + p.counts.clean + p.counts.pet;
  const perDay = cares / days;
  const care = perDay >= 8 ? 3 : perDay >= 4 ? 2 : perDay >= 1 ? 1 : 0;
  const trust = Math.min(3, (trustBits.reduce((v, b, i) => v | ((b ? 1 : 0) << i), 0) >> 1));
  const n = p.lessons.length;
  const lessons = n >= 5 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
  const strongest = argmax(TRAITS, (t) => p.traits[t]);
  const trait = p.traits[strongest] > 0 ? TRAITS.indexOf(strongest) + 1 : 0;
  return { diet, care, trust, lessons, trait };
}

export function evolutionWord(i: EvolutionInputs): number {
  return encodeSenses({ hunger: i.diet, joy: i.care, energy: i.trust, clean: i.lessons, time: 0, action: i.trait, event: 0, owner: 0 });
}

const circuit = fastBrain(compileProgram(EVOLUTION));

/** Run the public evolution circuit. */
export function evolve(i: EvolutionInputs): { form: Form; rare: boolean; rule: number } {
  const word = evolutionWord(i);
  const out = circuit.step(new Uint8Array(0), word);
  const rule = runBeat(EVOLUTION, [], word).rule;
  return { form: FORMS[out & 7] ?? "puff", rare: ((out >> 3) & 3) === 1, rule };
}
