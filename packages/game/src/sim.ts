/**
 * The pet's life, beat by beat.
 *
 * Each beat:
 *   1. the meters decay (or energy recovers while asleep);
 *   2. the 16-bit input word is built from the meters, the pet's local time of
 *      day, the care action just taken, the event around it and whether the
 *      owner is present;
 *   3. the brain circuit runs one step on that word and its LATCH memory;
 *   4. its answer (want, mood, nudge) moves the pet: it may fall asleep, sulk,
 *      cuddle or wander, and a nudge grows one trait;
 *   5. the word joins the input log that the next checkpoint commits to.
 *
 * Everything is integer and depends only on the state and the inputs, so a day
 * replays to identical bits anywhere, including against the circuit on chain.
 */

import { type FastBrain, type Program, encodeSenses, hungerBucket, bucket, inputField, runBeat, stateBits, timeOfDay } from "@lingxi/brain";
import { foodById } from "./items";
import { chainLog, ZERO_HASH } from "./log";
import {
  BEAT_MS,
  DECAY_PER_HOUR,
  HIBERNATE_AFTER,
  KINSHIP_DECAY,
  KINSHIP_EVERY,
  KINSHIP_MAX,
  SICK_AFTER,
  type CareMiss,
  MAX_CATCH_UP,
  METER_MAX,
  SLEEP_GAIN_PER_HOUR,
  SUB,
  TRAITS,
  TRAIT_MAX,
  type PetState,
  beatOf,
  clampMeter,
  toVisible,
} from "./pet";
import type { StarterLine } from "@lingxi/brain";
import { boosted, decayLeft, effectOf, newGrowth } from "./skills";

export const ACTION = { none: 0, feed: 1, play: 2, clean: 3, lightsOff: 4, pet: 5, medicine: 6, talk: 7 } as const;
export const EVENT = { none: 0, friend: 1, toy: 2, scary: 3 } as const;
export const WANT = { idle: 0, eat: 1, play: 2, sleep: 3, explore: 4, sulk: 5, cuddle: 6, share: 7 } as const;

export interface Brain {
  fast: FastBrain;
  nState: number;
  /** the program the circuit was compiled from; when present, live beats record which rule decided */
  program?: Program;
  /** for a child: the day half (parent A) and night half (parent B) its circuit is built from */
  halves?: [Program, Program];
  /** an owned instinct circuit, its memory starting at bit `from`; when it wants anything, it answers */
  instinct?: { fast: FastBrain; from: number };
}

export interface NewPet {
  name: string;
  line: StarterLine;
  now: number;
  tzOffsetMin: number;
  brain: Brain;
  instincts?: number;
}

export type Pet = PetState & { tzOffsetMin: number };

export function createPet({ name, line, now, tzOffsetMin, brain, instincts }: NewPet): Pet {
  const full = (v: number) => v * SUB;
  return {
    version: 1,
    name,
    line,
    bornAt: now,
    beat: beatOf(now),
    meters: { food: full(620), joy: full(700), energy: full(800), clean: full(900) },
    asleep: false,
    hibernating: false,
    starvingBeats: 0,
    brain: new Array(brain.nState).fill(0),
    lessons: [],
    ...(instincts ? { instincts } : {}),
    traits: Object.fromEntries(TRAITS.map((t) => [t, 0])) as Pet["traits"],
    xp: 0,
    growth: newGrowth(),
    counts: { feed: 0, play: 0, clean: 0, pet: 0, lessons: 0 },
    diet: { sweet: 0, fruit: 0, savory: 0, grain: 0 },
    logHash: ZERO_HASH,
    pendingLog: [],
    last: { want: 0, mood: 1, nudge: 0, rule: -1, word: 0 },
    tzOffsetMin,
  };
}

function cloneForEdit(p: Pet): Pet {
  return {
    ...p,
    meters: { ...p.meters },
    brain: p.brain.slice(),
    lessons: p.lessons.slice(),
    traits: { ...p.traits },
    counts: { ...p.counts },
    diet: { ...p.diet },
    pendingLog: p.pendingLog.slice(),
    last: { ...p.last },
    ...(p.missed ? { missed: p.missed.slice() } : {}),
  };
}

/** The pet's local hour at a beat. */
export function localHour(p: Pick<Pet, "tzOffsetMin">, beat: number): number {
  const minutes = beat + p.tzOffsetMin;
  return (((Math.floor(minutes / 60) % 24) + 24) % 24);
}

export function inputWord(p: Pet, beat: number, action: number, event: number, owner: boolean): number {
  return encodeSenses({
    hunger: hungerBucket(toVisible(p.meters.food)),
    joy: bucket(toVisible(p.meters.joy)),
    energy: bucket(toVisible(p.meters.energy)),
    clean: bucket(toVisible(p.meters.clean)),
    time: timeOfDay(localHour(p, beat)),
    action,
    event,
    owner: owner ? 1 : 0,
  });
}

/**
 * Kinship read lazily: one point fades for every
 * full day since it was last earned, computed from timestamps, never by a timer.
 */
export function kinshipNow(p: Pick<Pet, "kinship" | "kinBeat" | "growth">, beat: number): number {
  if (p.kinBeat === undefined) return p.kinship ?? 0;
  // Kin Keeper (plan 4.4): a point fades over a longer stretch
  const every = boosted(KINSHIP_DECAY, effectOf(p.growth, "KINSHIP_KEEP"));
  return Math.max(0, (p.kinship ?? 0) - Math.floor(Math.max(0, beat - p.kinBeat) / every));
}

/**
 * Experience, with the pet's XP skills (plan 4.4) applied exactly: the boost is counted in hundredths and the
 * remainder carried, so even +3% adds up over many small gains instead of always rounding away.
 */
export function gainXp(p: Pet, n: number): void {
  if (n <= 0) return;
  const hundredths = (p.xpCarry ?? 0) + n * (100 + effectOf(p.growth, "XP_GAIN"));
  p.xp = Math.min(0xffff, p.xp + Math.floor(hundredths / 100));
  p.xpCarry = hundredths % 100;
}

/** A care mistake: counted and remembered for the screen, never punished beyond the moment. */
function miss(p: Pet, kind: CareMiss, beat: number): void {
  p.mistakes = Math.min(63, (p.mistakes ?? 0) + 1);
  p.missed = [...(p.missed ?? []), { kind, beat }].slice(-8);
}

function decay(p: Pet, beat = p.beat): void {
  if (p.hibernating) return;
  const was = { food: p.meters.food, joy: p.meters.joy, clean: p.meters.clean, energy: p.meters.energy };
  const ill = p.sick ? 2 : 1;
  // the Care skills (plan 4.4) slow each meter's decay and strengthen sleep; integer maths, so a replay agrees
  const g = p.growth;
  const less = (m: "food" | "joy" | "clean" | "energy") => Math.floor((DECAY_PER_HOUR[m] * decayLeft(g, m)) / 1000);
  p.meters.food = clampMeter(p.meters.food - less("food"));
  p.meters.joy = clampMeter(p.meters.joy - less("joy") * ill);
  p.meters.clean = clampMeter(p.meters.clean - less("clean"));
  p.meters.energy = clampMeter(p.meters.energy + (p.asleep ? boosted(SLEEP_GAIN_PER_HOUR, effectOf(g, "SLEEP_GAIN")) : -less("energy") * ill));
  for (const k of ["food", "joy", "clean", "energy"] as const) if (was[k] > 0 && p.meters[k] === 0) miss(p, k, beat);
  // neglect: an empty food bowl or a filthy pet, six hours running, makes it ill
  p.dirtyBeats = p.meters.clean === 0 || p.meters.food === 0 ? (p.dirtyBeats ?? 0) + 1 : 0;
  if (!p.sick && p.dirtyBeats >= boosted(SICK_AFTER, effectOf(g, "SICK_GRACE"))) {
    p.sick = true;
    miss(p, "sick", beat);
  }
  p.starvingBeats = p.meters.food === 0 ? p.starvingBeats + 1 : 0;
  if (p.starvingBeats >= boosted(HIBERNATE_AFTER, effectOf(g, "HIBERNATE_GRACE"))) {
    p.hibernating = true;
    p.asleep = true;
  }
}

const addVisible = (internal: number, visible: number) => clampMeter(internal + visible * SUB);
/** A good thing made better by a percent skill; a bad one (a negative amount) is left as it is. */
const more = (amount: number, pct: number) => (amount > 0 ? boosted(amount, pct) : amount);

/** Run the brain on one beat and let its answer move the pet. Mutates p. */
function think(p: Pet, brain: Brain, beat: number, action: number, event: number, owner: boolean): void {
  const word = inputWord(p, beat, action, event, owner);
  let rule = -1;
  let half: 0 | 1 | undefined;
  if (owner && brain.program) rule = runBeat(brain.program, p.brain.slice(0, stateBits(brain.program)), word).rule;
  else if (owner && brain.halves) {
    // the child's want comes from parent A's half by morning and day, B's by evening and night
    const time = (word >> inputField("time").lo) & 3;
    half = time === 1 || time === 2 ? 0 : 1;
    const nA = stateBits(brain.halves[0]);
    rule = runBeat(brain.halves[half], half === 0 ? p.brain.slice(0, nA) : p.brain.slice(nA), word).rule;
  }
  const before = p.brain.slice();
  const st = Uint8Array.from(p.brain);
  const out = brain.fast.step(st, word);
  p.brain = Array.from(st);
  const want = out & 7;
  const mood = (out >> 3) & 3;
  const nudge = (out >> 5) & 7;
  // when the owned instinct answered, no rule of the pet's own decided
  const instinctSpoke = owner && brain.instinct ? (brain.instinct.fast.step(Uint8Array.from(before.slice(brain.instinct.from)), word) & 7) !== 0 : false;
  p.last = { want, mood, nudge, rule: instinctSpoke ? -1 : rule, word, before, ...(half !== undefined ? { half } : {}), ...(instinctSpoke ? { instinct: true as const } : {}) };
  p.logHash = chainLog(p.logHash, word);
  if (p.logBeat === undefined || beat !== p.logBeat + 1) p.logMarks = [...(p.logMarks ?? []), [p.pendingLog.length, beat]];
  p.logBeat = beat;
  p.pendingLog.push(word);

  const energy = toVisible(p.meters.energy);
  if (!p.asleep && want === WANT.sleep && energy < 600) p.asleep = true;
  else if (p.asleep && !p.hibernating && energy >= 950 && timeOfDay(localHour(p, beat)) !== 0) p.asleep = false;
  if (!p.asleep) {
    if (want === WANT.sulk) p.meters.joy = addVisible(p.meters.joy, -2);
    if (want === WANT.cuddle && owner) p.meters.joy = addVisible(p.meters.joy, 3);
    if (want === WANT.play && owner) {
      p.meters.joy = addVisible(p.meters.joy, 2);
      p.meters.energy = addVisible(p.meters.energy, -1);
    }
    if (want === WANT.explore) {
      p.meters.joy = addVisible(p.meters.joy, 1);
      p.meters.clean = addVisible(p.meters.clean, -2);
    }
  }
  if (nudge > 0 && (action !== ACTION.none || event !== EVENT.none)) {
    const t = TRAITS[nudge - 1]!;
    // Deep Memory (plan 4.4): a percent more growth, carried exactly in hundredths like experience
    const grow = (p.traitCarry ?? 0) + 100 + effectOf(p.growth, "TRAIT_GROWTH");
    p.traits[t] = Math.min(TRAIT_MAX, p.traits[t] + Math.floor(grow / 100));
    if (effectOf(p.growth, "TRAIT_GROWTH")) p.traitCarry = grow % 100;
  }
  if (owner && action !== ACTION.none) gainXp(p, 1);
}

/** Replay every beat from the pet's last beat up to `now`, the owner away. */
export function catchUp(p0: Pet, now: number, brain: Brain, eventAt: (beat: number) => number = () => EVENT.none): Pet {
  const target = beatOf(now);
  if (target <= p0.beat) return p0;
  const p = cloneForEdit(p0);
  const gap = target - p.beat;
  const skipped = Math.max(0, gap - MAX_CATCH_UP);
  let b = p.beat + skipped;
  while (b < target) {
    b += 1;
    decay(p, b);
    if (!p.hibernating) think(p, brain, b, ACTION.none, eventAt(b), false);
  }
  p.beat = target;
  return p;
}

/** What an item does when used on the pet (visible meter units). */
export interface ItemEffect {
  food?: number;
  joy?: number;
  energy?: number;
  clean?: number;
  xp?: number;
  diet?: "sweet" | "fruit" | "savory" | "grain";
  wake?: boolean;
}

export type Care =
  | { kind: "feed"; food: string | ItemEffect }
  | { kind: "use"; item: ItemEffect }
  | { kind: "play"; stars?: number }
  | { kind: "clean" }
  | { kind: "lightsOff" }
  | { kind: "wake" }
  | { kind: "pet" }
  | { kind: "medicine" }
  | { kind: "talk" };

export interface CareResult {
  pet: Pet;
  /** what the owner sees happen, for the diary and the screen */
  note: "ate" | "overfed" | "woke" | "played" | "tooTired" | "tooSick" | "cleaned" | "sleeping" | "awake" | "petted" | "healed" | "notSick" | "listened" | "hibernationEnded" | "used";
}

/**
 * The owner does something. The pet is first brought up to the present, then the
 * care is applied, then one live beat runs with the action on the brain's pins.
 */
export function care(p0: Pet, c: Care, now: number, brain: Brain, event = EVENT.none): CareResult {
  const p = cloneForEdit(catchUp(p0, now, brain));
  let action: number = ACTION.none;
  let note: CareResult["note"] = "listened";
  const wakes = c.kind === "use" && c.item.wake === true;
  if (p.hibernating) {
    if (c.kind === "feed" || c.kind === "pet" || c.kind === "wake" || wakes) {
      p.hibernating = false;
      p.asleep = false;
      p.starvingBeats = 0;
      p.meters.food = addVisible(p.meters.food, 200);
      p.meters.joy = clampMeter(p.meters.joy - 100 * SUB);
      return { pet: p, note: "hibernationEnded" };
    }
  }
  switch (c.kind) {
    case "feed": {
      const f: ItemEffect = typeof c.food === "string" ? foodById(c.food) : c.food;
      const wasFull = toVisible(p.meters.food) >= 900;
      p.meters.food = addVisible(p.meters.food, more(f.food ?? 0, effectOf(p.growth, "FOOD_ITEM")));
      p.meters.joy = addVisible(p.meters.joy, wasFull ? -40 : more(f.joy ?? 0, effectOf(p.growth, "JOY_ITEM")));
      if (f.energy) p.meters.energy = addVisible(p.meters.energy, f.energy);
      if (f.xp) gainXp(p, f.xp);
      if (f.diet) p.diet[f.diet] = Math.min(63, p.diet[f.diet] + 1);
      p.counts.feed = Math.min(255, p.counts.feed + 1);
      if (p.asleep) {
        p.asleep = false;
        note = "woke";
      } else note = wasFull ? "overfed" : "ate";
      action = ACTION.feed;
      break;
    }
    case "play": {
      if (p.sick) {
        note = "tooSick";
        action = ACTION.play;
        break;
      }
      if (toVisible(p.meters.energy) < 120) {
        note = "tooTired";
        action = ACTION.play;
        break;
      }
      p.asleep = false;
      // a mini-game played well (up to 3 stars) cheers it up more and teaches it more
      const stars = Math.max(0, Math.min(3, Math.floor(c.stars ?? 0)));
      p.meters.joy = addVisible(p.meters.joy, more(220 + 60 * stars, effectOf(p.growth, "JOY_ITEM")));
      p.meters.energy = addVisible(p.meters.energy, -80);
      p.meters.food = addVisible(p.meters.food, -40);
      gainXp(p, 2 * stars);
      p.counts.play = Math.min(255, p.counts.play + 1);
      note = "played";
      action = ACTION.play;
      break;
    }
    case "clean":
      p.meters.clean = METER_MAX * SUB;
      if (effectOf(p.growth, "BATH_JOY")) p.meters.joy = addVisible(p.meters.joy, effectOf(p.growth, "BATH_JOY"));
      p.counts.clean = Math.min(255, p.counts.clean + 1);
      note = "cleaned";
      action = ACTION.clean;
      break;
    case "lightsOff":
      p.asleep = true;
      note = "sleeping";
      action = ACTION.lightsOff;
      break;
    case "wake":
      p.asleep = false;
      note = "awake";
      break;
    case "pet":
      p.meters.joy = addVisible(p.meters.joy, 40);
      p.counts.pet = Math.min(255, p.counts.pet + 1);
      // kinship grows at most once every 12 hours (after any fading is settled)
      // Warm Memory (plan 4.4): kinship may grow sooner, never more often than every six hours
      if (p.kinBeat === undefined || p.beat - p.kinBeat >= Math.max(360, KINSHIP_EVERY - effectOf(p.growth, "KINSHIP_SOONER"))) {
        p.kinship = Math.min(KINSHIP_MAX, kinshipNow(p, p.beat) + 1);
        p.kinBeat = p.beat;
      }
      note = "petted";
      action = ACTION.pet;
      break;
    case "use": {
      const u = c.item;
      if (u.food) p.meters.food = addVisible(p.meters.food, more(u.food, effectOf(p.growth, "FOOD_ITEM")));
      if (u.joy) p.meters.joy = addVisible(p.meters.joy, more(u.joy, effectOf(p.growth, "JOY_ITEM")));
      if (u.energy) p.meters.energy = addVisible(p.meters.energy, u.energy);
      if (u.clean) p.meters.clean = addVisible(p.meters.clean, u.clean);
      if (u.xp) gainXp(p, u.xp);
      if (u.wake) p.asleep = false;
      note = "used";
      action = ACTION.medicine;
      break;
    }
    case "medicine":
      if (p.sick) {
        p.sick = false;
        p.dirtyBeats = 0;
        p.meters.energy = addVisible(p.meters.energy, 100);
        note = "healed";
      } else note = "notSick";
      action = ACTION.medicine;
      break;
    case "talk":
      note = "listened";
      action = ACTION.talk;
      break;
  }
  think(p, brain, p.beat, action, event, true);
  return { pet: p, note };
}

/** One live beat with the owner watching and nothing done (the app is open). */
export function liveBeat(p0: Pet, now: number, brain: Brain, event = EVENT.none): Pet {
  const target = beatOf(now);
  if (target <= p0.beat) return p0;
  const p = cloneForEdit(catchUp(p0, now - BEAT_MS, brain));
  p.beat = target;
  decay(p, target);
  if (!p.hibernating) think(p, brain, target, ACTION.none, event, true);
  return p;
}

/** Walking and searching tire the pet: energy spent, no beat logged. */
export function exert(p0: Pet, energy: number, now: number, brain: Brain): Pet {
  const p = cloneForEdit(catchUp(p0, now, brain));
  p.meters.energy = clampMeter(p.meters.energy - Math.max(0, energy) * SUB);
  return p;
}

/** Work at the bench (plan 4.5): the recipe's energy spent and its experience earned, with the XP skills applied. */
export function work(p0: Pet, energy: number, xp: number, now: number, brain: Brain): Pet {
  const p = exert(p0, energy, now, brain);
  gainXp(p, xp);
  return p;
}
