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
  /** LATCH memory of the brain, one bit per entry */
  brain: number[];
  /** rules the owner taught, highest priority first */
  lessons: Rule[];
  traits: Record<Trait, number>;
  xp: number;
  counts: { feed: number; play: number; clean: number; pet: number; lessons: number };
  diet: Record<Diet, number>;
  /** keccak hash chain of every input word since hatching */
  logHash: string;
  /** every input word since hatching, in order (the log the checkpoints commit to) */
  pendingLog: number[];
  /** which lessons the brain had from each point of the log on: segment i covers words from[i]..from[i+1]-1 */
  segments?: Array<{ from: number; lessons: import("@lingxi/brain").Rule[] }>;
  /** last brain answer, for the screen */
  last: { want: number; mood: number; nudge: number; rule: number; word: number; before?: number[] };
}

export const toVisible = (internal: number): number => Math.floor(internal / SUB);
export const visibleMeters = (p: PetState): Meters => ({
  food: toVisible(p.meters.food),
  joy: toVisible(p.meters.joy),
  energy: toVisible(p.meters.energy),
  clean: toVisible(p.meters.clean),
});

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
