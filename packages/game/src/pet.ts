/**
 * A Lingxi pet's state and the fixed numbers of its life.
 *
 * Time runs in beats: one beat per whole minute of the real clock. Everything
 * about the pet is a pure function of its state and the beats that happened,
 * so the same day replays to the same bits on any machine.
 *
 * Meters are kept in sixtieths so a per-hour rate becomes a whole number per
 * beat; the visible value is 0..1000.
 */

import type { Rule, StarterLine } from "@lingxi/brain";

export const BEAT_MS = 60_000;
export const DAY_MS = 86_400_000;
export const METER_MAX = 1000;
export const SUB = 60; // internal units per visible unit

export type MeterName = "food" | "joy" | "energy" | "clean";
export const METERS: readonly MeterName[] = ["food", "joy", "energy", "clean"];

/** Visible units lost per hour (per beat in internal units). */
export const DECAY_PER_HOUR = { food: 45, joy: 30, energy: 28, clean: 18 } as const;
/** Energy regained per hour while asleep. */
export const SLEEP_GAIN_PER_HOUR = 90;
/** Beats of an empty food meter before the pet hibernates (a day). */
export const HIBERNATE_AFTER = 24 * 60;
/** The longest absence replayed beat by beat; anything longer is replayed as this many beats. */
export const MAX_CATCH_UP = 3 * 24 * 60;
/** beats of neglect (food or cleanliness at zero) before the pet falls ill */
export const SICK_AFTER = 6 * 60;
/** kinship: petting counts once per 12 hours; a full day unpetted costs one */
export const KINSHIP_EVERY = 12 * 60;
export const KINSHIP_DECAY = 24 * 60;
export const KINSHIP_MAX = 255;

/** Level from XP: level n needs 25·n·(n+1)/2 XP in total, so each level is harder to reach. */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  while (25 * (level * (level + 1)) / 2 <= xp) level++;
  const start = (25 * ((level - 1) * level)) / 2;
  const end = (25 * (level * (level + 1))) / 2;
  return { level, into: xp - start, need: end - start };
}

export type CareMiss = "food" | "joy" | "clean" | "energy" | "sick";

export const TRAITS = ["brave", "curious", "greedy", "calm", "playful", "gentle", "shy"] as const;
export type Trait = (typeof TRAITS)[number];
export const TRAIT_MAX = 15;

export type Stage = "egg" | "baby" | "child" | "teen" | "adult" | "elder";
/** Day each stage begins (day 1 is hatch day). */
export const STAGE_DAYS: Record<Exclude<Stage, "egg">, number> = { baby: 1, child: 2, teen: 4, adult: 8, elder: 31 };

export const DIETS = ["sweet", "fruit", "savory", "grain"] as const;
export type Diet = (typeof DIETS)[number];

export interface Meters {
  food: number;
  joy: number;
  energy: number;
  clean: number;
}

export interface PetState {
  version: 1;
  name: string;
  line: StarterLine;
  /** ms timestamp the pet hatched */
  bornAt: number;
  /** the last beat applied, in whole minutes since the epoch */
  beat: number;
  /** internal units (visible × 60) */
  meters: Meters;
  asleep: boolean;
  hibernating: boolean;
  /** consecutive beats with an empty food meter */
  starvingBeats: number;
  /** ill from neglect; medicine cures it */
  sick?: boolean;
  /** consecutive beats with food or cleanliness at zero */
  dirtyBeats?: number;
  /** care mistakes so far (a meter running out, falling ill), shown kindly, never punished */
  mistakes?: number;
  /** the latest few, for the screen */
  missed?: Array<{ kind: CareMiss; beat: number }>;
  /** kinship and the beat it was last earned */
  kinship?: number;
  kinBeat?: number;
  /** LATCH memory of the brain, one bit per entry */
  brain: number[];
  /** rules the owner taught, highest priority first */
  lessons: Rule[];
  /** owner's side: the pet is staying with a friend (this copy waits, frozen, until it comes home) */
  away?: { code: string; key: string; until: number; sitter: string | null };
  /** friend's side: this is someone else's pet staying here; it goes home to its owner */
  sitting?: { code: string; key: string; until: number; owner: string | null; name: string };
  /** the adult form, decided once by the evolution circuit on the day it grows up */
  form?: "puff" | "blossom" | "dumpling" | "scholar" | "moonpetal";
  /** the four instinct switches chosen at hatching (1 brave · 2 greedy · 4 curious · 8 calm); fixed for life */
  instincts?: number;
  /** an owned circuit taught as an everyday instinct: when it wants anything but idle, it answers */
  outside?: OutsideInstinct;
  traits: Record<Trait, number>;
  xp: number;
  counts: { feed: number; play: number; clean: number; pet: number; lessons: number };
  diet: Record<Diet, number>;
  /** keccak hash chain of every input word since hatching */
  logHash: string;
  /** every input word since hatching, in order (the log the checkpoints commit to) */
  pendingLog: number[];
  /**
   * When each logged word happened, kept sparsely: [log index, beat] wherever the
   * log stops being one word per consecutive beat (a care action inside a beat, a
   * gap while asleep for good or away too long). Absent for pets from before it.
   */
  logMarks?: Array<[number, number]>;
  /** the beat of the last logged word */
  logBeat?: number;
  /** which lessons the brain had from each point of the log on: segment i covers words from[i]..from[i+1]-1 */
  segments?: Array<{ from: number; lessons: import("@lingxi/brain").Rule[]; outside?: OutsideInstinct }>;
  /** set for a pet born of two parents: its mind is built from both of theirs */
  family?: Family;
  /** last brain answer, for the screen */
  last: { want: number; mood: number; nudge: number; rule: number; word: number; before?: number[]; half?: 0 | 1; instinct?: true };
  /** day number (since birth) this pet last had a child */
  lastBredDay?: number;
}

export const toVisible = (internal: number): number => Math.floor(internal / SUB);
export const visibleMeters = (p: PetState): Meters => ({
  food: toVisible(p.meters.food),
  joy: toVisible(p.meters.joy),
  energy: toVisible(p.meters.energy),
  clean: toVisible(p.meters.clean),
});

/** The pet's lowest need, 0 to METER_MAX: how close the emptiest of food, joy, energy and clean is to empty. */
export const needsMinOf = (p: PetState): number => {
  const m = visibleMeters(p);
  return Math.min(m.food, m.joy, m.energy, m.clean);
};

export const clampMeter = (internal: number): number => Math.max(0, Math.min(METER_MAX * SUB, internal));

export function dayOf(p: Pick<PetState, "bornAt">, now: number): number {
  return Math.floor((now - p.bornAt) / DAY_MS) + 1;
}

export function stageOf(p: Pick<PetState, "bornAt">, now: number): Exclude<Stage, "egg"> {
  const d = dayOf(p, now);
  if (d >= STAGE_DAYS.elder) return "elder";
  if (d >= STAGE_DAYS.adult) return "adult";
  if (d >= STAGE_DAYS.teen) return "teen";
  if (d >= STAGE_DAYS.child) return "child";
  return "baby";
}

export const beatOf = (ms: number): number => Math.floor(ms / BEAT_MS);

/** One parent as the child remembers it: enough to rebuild that half of its mind. */
export interface ParentInfo {
  name: string;
  line: "gentle" | "bold" | "curious";
  lessons: import("@lingxi/brain").Rule[];
  /** the parent's instinct switches, which live on in its half of the child's mind */
  instincts?: number;
  /** on-chain pet id and owner, when the parent lived on chain */
  petId?: number;
  owner?: string;
  /** the parent's birth time when it lives on this device, to link the family tree */
  key?: string;
}

/**
 * An owned circuit taught as an everyday instinct (PRD X1): kept as the bytes it
 * was taped out with (and every circuit it REFs), so the mind rebuilds offline.
 */
export interface OutsideInstinct {
  processor: string;
  id: string;
  /** the wallet that owned the circuit when it was taught */
  owner: string;
  parts: Array<{ processor: string; id: string; nIn: number; nOut: number; hex: string }>;
}

export interface Family {
  parents: [ParentInfo, ParentInfo];
  /** parents' generation + 1; starters are generation 0 */
  generation: number;
}
