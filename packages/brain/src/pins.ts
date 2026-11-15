/**
 * LX-PET/1: the pins of a Lingxi pet brain.
 *
 * 16 input pins, read every beat (bit 0 = pin 0, TapeOut's packing order):
 *   0-1   hunger   0 full · 1 peckish · 2 hungry · 3 starving
 *   2-3   joy      0 sad · 1 low · 2 happy · 3 joyful
 *   4-5   energy   0 exhausted · 1 tired · 2 fine · 3 rested
 *   6-7   clean    0 filthy · 1 dusty · 2 tidy · 3 spotless
 *   8-9   time     0 night · 1 morning · 2 day · 3 evening
 *   10-12 action   what the owner just did (see ACTIONS)
 *   13-14 event    0 none · 1 friend near · 2 toy near · 3 something scary
 *   15    owner    1 when the owner is with the pet
 *
 * 8 output pins:
 *   0-2   want     what the pet does next (see WANTS)
 *   3-4   mood     0 grumpy · 1 calm · 2 happy · 3 excited
 *   5-7   nudge    0 none, else one step of trait drift (see NUDGES)
 *
 * Memory lives in LATCH bits after these. Each program declares its own memory
 * fields; their bits follow the order of declaration.
 */

export const PIN_VERSION = "LX-PET/1";
export const N_IN = 16;
export const N_OUT = 8;

export interface FieldSpec {
  readonly name: InputField;
  readonly lo: number;
  readonly bits: number;
  readonly values: readonly string[];
}

export const INPUT_FIELDS = [
  { name: "hunger", lo: 0, bits: 2, values: ["full", "peckish", "hungry", "starving"] },
  { name: "joy", lo: 2, bits: 2, values: ["sad", "low", "happy", "joyful"] },
  { name: "energy", lo: 4, bits: 2, values: ["exhausted", "tired", "fine", "rested"] },
  { name: "clean", lo: 6, bits: 2, values: ["filthy", "dusty", "tidy", "spotless"] },
  { name: "time", lo: 8, bits: 2, values: ["night", "morning", "day", "evening"] },
  {
    name: "action",
    lo: 10,
    bits: 3,
    values: ["none", "feed", "play", "clean", "lightsOff", "pet", "medicine", "talk"],
  },
  { name: "event", lo: 13, bits: 2, values: ["none", "friend", "toy", "scary"] },
  { name: "owner", lo: 15, bits: 1, values: ["away", "here"] },
] as const satisfies readonly { name: string; lo: number; bits: number; values: readonly string[] }[];

export type InputField = (typeof INPUT_FIELDS)[number]["name"];
export const INPUT_FIELD_NAMES: readonly InputField[] = INPUT_FIELDS.map((f) => f.name);

export const WANTS = ["idle", "eat", "play", "sleep", "explore", "sulk", "cuddle", "share"] as const;
export type Want = (typeof WANTS)[number];
export const MOODS = ["grumpy", "calm", "happy", "excited"] as const;
export type Mood = (typeof MOODS)[number];
export const NUDGES = ["none", "brave", "curious", "greedy", "calm", "playful", "gentle", "shy"] as const;
export type Nudge = (typeof NUDGES)[number];

export interface Senses {
  hunger: number;
  joy: number;
  energy: number;
  clean: number;
  time: number;
  action: number;
  event: number;
  owner: number;
}

export function inputField(name: InputField): (typeof INPUT_FIELDS)[number] {
  const f = INPUT_FIELDS.find((x) => x.name === name);
  if (!f) throw new Error(`unknown input field ${name}`);
  return f;
}

export function encodeSenses(s: Senses): number {
  let w = 0;
  for (const f of INPUT_FIELDS) {
    const v = s[f.name];
    const max = (1 << f.bits) - 1;
    if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${f.name} must be 0..${max}, got ${v}`);
    w |= v << f.lo;
  }
  return w;
}

export function decodeSenses(word: number): Senses {
  const s = {} as Senses;
  for (const f of INPUT_FIELDS) s[f.name] = (word >>> f.lo) & ((1 << f.bits) - 1);
  return s;
}

export interface Output {
  want: number;
  mood: number;
  nudge: number;
}

export const encodeOutput = (o: Output): number => (o.want & 7) | ((o.mood & 3) << 3) | ((o.nudge & 7) << 5);
export const decodeOutput = (w: number): Output => ({ want: w & 7, mood: (w >> 3) & 3, nudge: (w >> 5) & 7 });

/** A 0..1000 meter to its 2-bit bucket. Same thresholds everywhere, integer only. */
export function bucket(v1000: number): number {
  return v1000 < 250 ? 0 : v1000 < 500 ? 1 : v1000 < 750 ? 2 : 3;
}

/** Hunger rises as the food meter falls, so it is the bucket of the inverse. */
export const hungerBucket = (food1000: number): number => 3 - bucket(food1000);

/** Local hour (0-23) to the time field. */
export function timeOfDay(hour: number): number {
  if (hour < 6) return 0;
  if (hour < 11) return 1;
  if (hour < 17) return 2;
  if (hour < 21) return 3;
  return 0;
}
