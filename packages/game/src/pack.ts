/**
 * The pet's whole state as the single 256-bit word PetRegistry stores.
 *
 *   bits   0- 63  brain LATCH memory (bit i = latch i)
 *   bits  64-103  food, joy, energy, clean (10 bits each, visible 0..1000)
 *   bits 104-131  traits brave..shy (4 bits each)
 *   bits 132-147  xp
 *   bits 148-150  stage (0 egg · 1 baby · 2 child · 3 teen · 4 adult · 5 elder)
 *   bit  151      asleep
 *   bits 152-153  line (0 gentle · 1 bold · 2 curious)
 *   bit  154      hibernating
 *   bits 155-194  counts: feed, play, clean, pet, lessons (8 bits each)
 *   bits 195-218  diet: sweet, fruit, savory, grain (6 bits each)
 *   bit  219      sick
 *   bits 220-225  care mistakes (0..63)
 *   bits 226-233  kinship (0..255)
 *   bits 234-255  reserved, zero
 */

import { DIETS, METERS, SUB, TRAITS, type Stage, toVisible } from "./pet";
import { type Pet, kinshipNow } from "./sim";
import type { StarterLine } from "@lingxi/brain";

const LINES: readonly StarterLine[] = ["gentle", "bold", "curious"];
const STAGES: readonly Stage[] = ["egg", "baby", "child", "teen", "adult", "elder"];
const COUNTS = ["feed", "play", "clean", "pet", "lessons"] as const;

function put(w: bigint, at: number, bits: number, v: number): bigint {
  const max = (1 << bits) - 1;
  if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`value ${v} does not fit ${bits} bits at ${at}`);
  return w | (BigInt(v) << BigInt(at));
}
const get = (w: bigint, at: number, bits: number): number => Number((w >> BigInt(at)) & ((1n << BigInt(bits)) - 1n));

export function packState(p: Pet, stage: Stage): bigint {
  if (p.brain.length > 64) throw new Error("brain memory over 64 bits");
  let w = 0n;
  p.brain.forEach((b, i) => {
    if (b) w |= 1n << BigInt(i);
  });
  METERS.forEach((m, i) => {
    w = put(w, 64 + 10 * i, 10, Math.min(1000, toVisible(p.meters[m])));
  });
  TRAITS.forEach((t, i) => {
    w = put(w, 104 + 4 * i, 4, p.traits[t]);
  });
  w = put(w, 132, 16, p.xp);
  w = put(w, 148, 3, STAGES.indexOf(stage));
  w = put(w, 151, 1, p.asleep ? 1 : 0);
  w = put(w, 152, 2, LINES.indexOf(p.line));
  w = put(w, 154, 1, p.hibernating ? 1 : 0);
  COUNTS.forEach((c, i) => {
    w = put(w, 155 + 8 * i, 8, p.counts[c]);
  });
  DIETS.forEach((d, i) => {
    w = put(w, 195 + 6 * i, 6, p.diet[d]);
  });
  w = put(w, 219, 1, p.sick ? 1 : 0);
  w = put(w, 220, 6, Math.min(63, p.mistakes ?? 0));
  w = put(w, 226, 8, Math.min(255, kinshipNow(p, p.beat)));
  return w;
}

export interface UnpackedState {
  brain: number[];
  meters: Record<(typeof METERS)[number], number>;
  traits: Record<(typeof TRAITS)[number], number>;
  xp: number;
  stage: Stage;
  asleep: boolean;
  line: StarterLine;
  hibernating: boolean;
  sick: boolean;
  mistakes: number;
  kinship: number;
  counts: Record<(typeof COUNTS)[number], number>;
  diet: Record<(typeof DIETS)[number], number>;
}

export function unpackState(w: bigint, brainBits: number): UnpackedState {
  if (w < 0n || w >= 1n << 256n) throw new Error("state must be 256 bits");
  const brain = Array.from({ length: brainBits }, (_, i) => get(w, i, 1));
  return {
    brain,
    meters: Object.fromEntries(METERS.map((m, i) => [m, get(w, 64 + 10 * i, 10)])) as UnpackedState["meters"],
    traits: Object.fromEntries(TRAITS.map((t, i) => [t, get(w, 104 + 4 * i, 4)])) as UnpackedState["traits"],
    xp: get(w, 132, 16),
    stage: STAGES[get(w, 148, 3)] ?? "egg",
    asleep: get(w, 151, 1) === 1,
    line: LINES[get(w, 152, 2)] ?? "gentle",
    hibernating: get(w, 154, 1) === 1,
    sick: get(w, 219, 1) === 1,
    mistakes: get(w, 220, 6),
    kinship: get(w, 226, 8),
    counts: Object.fromEntries(COUNTS.map((c, i) => [c, get(w, 155 + 8 * i, 8)])) as UnpackedState["counts"],
    diet: Object.fromEntries(DIETS.map((d, i) => [d, get(w, 195 + 6 * i, 6)])) as UnpackedState["diet"],
  };
}

/** Meters restored from a checkpoint, in internal units. */
export const metersFromVisible = (m: UnpackedState["meters"]) => ({
  food: m.food * SUB,
  joy: m.joy * SUB,
  energy: m.energy * SUB,
  clean: m.clean * SUB,
});
