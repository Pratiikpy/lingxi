/**
 * The game on this device: the pet, its compiled brain, and the guest save.
 * Progress lives in the browser (guest play); connecting a wallet later keeps
 * the same pet and starts writing daily checkpoints on chain.
 */

import { CARE_METRIC, useBadges } from "./badges";
import { noteEvent, noteTally, questSlots } from "./tally";
import { TIMES_OF_DAY } from "@lingxi/world";
import { saveWrite } from "./saveRuntime";
import { MAX_PETS, type Roster, keptName, readRoster, rosterText } from "./roster";
import { dayAtLeast } from "./days";
import { now as gameNow } from "./gameClock";

/** The picture of what was eaten: the item's own art, or the starter food's. */
function foodArt(c: Care, art?: string): string | undefined {
  if (art) return art;
  return c.kind === "feed" && typeof c.food === "string" ? FOODS.find((f) => f.id === c.food)?.art : undefined;
}

/** Stage as the "Growing up" badge counts it: child 2, teen 3, adult 4. */
const STAGE_RANK: Record<string, number> = { baby: 1, child: 2, teen: 3, adult: 4, elder: 4 };

/** What each successful care result counts as in the tally: CARE:<index>. */
const CARE_INDEX: Partial<Record<string, string>> = { ate: "feed", woke: "feed", played: "play", cleaned: "clean", sleeping: "sleep", awake: "wake", petted: "pet", healed: "medicine", listened: "talk", used: "use" };

/**
 * What a care counts for: quest and daily tallies, badges, today's care marks. The same whether the care was given
 * at home or on the handheld (plan 4.14), so care given anywhere counts once.
 */
export function countCare(kind: Care["kind"], wasAsleep: boolean, r: CareResult): void {
  // the tally counts what care actually did (plan 4.1); waking a pet that was not asleep did nothing
  const careIndex = CARE_INDEX[r.note];
  if (careIndex && !(kind === "wake" && !wasAsleep)) {
    noteTally("CARE", careIndex);
    if (careIndex === "pet" && takeComfort()) noteEvent("comforted");
    // the same care by the pet's time of day ("put it to bed at night"), a finer key of the same act
    noteTally("CARE", `${careIndex}-${TIMES_OF_DAY[timeOfDay(localHour(r.pet, r.pet.beat))]}`, 1, { total: false });
  }
  const metric = CARE_METRIC[r.note];
  if (metric) {
    const b = useBadges.getState();
    b.note("care");
    b.note(metric);
    b.note("kinship", kinshipNow(r.pet, r.pet.beat));
    b.note("stage", STAGE_RANK[stageOf(r.pet, gameNow())] ?? 0);
  }
  const g = useGame.getState();
  // a day only moves forward: a clock turned back keeps today's card instead of handing out a fresh one (days.ts)
  const day = dayAtLeast(todayKey(), g.daily.day);
  const d = g.daily.day === day ? { ...g.daily } : { ...freshDaily(), day };
  if (kind === "feed" && r.note !== "overfed") d.fed = true;
  if (kind === "play" && r.note === "played") d.played = true;
  if (kind === "clean") d.cleaned = true;
  if (kind === "pet") d.petted = true;
  useGame.setState({ daily: d });
}
import { create } from "zustand";
import { type Program, type Rule, STARTERS, compileProgram, fastBrain, stateBits, timeOfDay } from "@lingxi/brain";
import { FOODS, type Brain, type Care, type CareResult, type Growth, type Pet, type UpgradeRefusal, arrangeLessons, care, catchUp, composeProgram, createPet, halvesOf, kinshipNow, learnSkill, levelUpPet, liveBeat, mindBrain, respecPet, ruleSkillIds, settleForm, skillRules, stageOf, teach as teachRule, awayEvent, awaySeed, beatOf, localHour, instinctBrain, MAX_MIND_STATE, type OutsideInstinct, withSegment } from "@lingxi/game";
import type { StarterLine } from "@lingxi/brain";
import { takeComfort } from "./comfort";

const OLD_KEY = "lingxi.pet.v1";
const SAVE_KEY = "lingxi.pets.v2";
/** the most pets one player keeps on this device */
export { MAX_PETS };

/** An absence: which pet, and the beats it spanned. */
export interface Away {
  petKey: string;
  from: number;
  to: number;
}

const brains = new Map<string, Brain>();
/** The pet's whole program: what it was taught, the instincts it hatched with, its skill rules, then its egg line's starter rules. */
export function programFor(line: StarterLine, lessons: readonly Rule[] = [], instincts = 0, growth?: Growth): Program {
  const rules = skillRules(growth);
  return lessons.length || instincts || rules.length ? composeProgram(line, lessons, instincts, { rules }) : STARTERS[line];
}
export function brainFor(line: StarterLine, lessons: readonly Rule[] = [], instincts = 0, growth?: Growth): Brain {
  const key = line + instincts + JSON.stringify(lessons) + ruleSkillIds(growth).join(",");
  let b = brains.get(key);
  if (!b) {
    const p = programFor(line, lessons, instincts, growth);
    b = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
    brains.set(key, b);
  }
  return b;
}
export interface MindPart {
  program: Program;
  /** where this part's memory starts in the pet's memory bits */
  offset: number;
  /** for a child: which parent this half comes from and when it decides */
  from?: { name: string; when: "day" | "night" };
}

/** A pet's mind as the screens show it: one program, or a child's day half and night half. */
export function mindParts(pet: Pet): MindPart[] {
  if (!pet.family) return [{ program: programFor(pet.line, pet.lessons, pet.instincts, pet.growth), offset: 0 }];
  const [a, b] = halvesOf(pet.family, pet.lessons, skillRules(pet.growth));
  return [
    { program: a, offset: 0, from: { name: pet.family.parents[0].name, when: "day" } },
    { program: b, offset: stateBits(a), from: { name: pet.family.parents[1].name, when: "night" } },
  ];
}

/** The part of the mind that made the last decision. */
export function decidingPart(pet: Pet): MindPart {
  const parts = mindParts(pet);
  return parts[pet.last.half ?? 0] ?? parts[0]!;
}

/** Any pet's brain, including a child built from two parents. */
export const brainOf = (p: Pet): Brain => (p.family || p.outside ? mindBrain({ line: p.line, lessons: p.lessons ?? [], family: p.family, instincts: p.instincts, outside: p.outside, growth: p.growth }) : brainFor(p.line, p.lessons ?? [], p.instincts ?? 0, p.growth));

/** Pets this build cannot read, kept exactly as saved and written back with every save (roster.ts, P1). */
let kept: unknown[] = [];
/** The names of the pets kept safe for a newer Lingxi, for the pets screen. */
export const keptPetNames = (): string[] => kept.map(keptName);

function loadRoster(): Roster {
  try {
    // a save from before families (OLD_KEY) becomes the first pet of the roster
    const r = readRoster(localStorage.getItem(SAVE_KEY), localStorage.getItem(OLD_KEY));
    kept = r.kept;
    return r.roster;
  } catch {
    // a save that will not parse was held at start and waits for the player's choice (save.ts); nothing writes over it
    return { active: 0, pets: [] };
  }
}

let roster: Roster = loadRoster();

function persist(): void {
  try {
    saveWrite(SAVE_KEY, rosterText(roster, kept));
  } catch {
    // storage full or blocked: the pets keep living in memory for this visit
  }
}

/** Saves the active pet (or adds the first one). */
function save(p: Pet | null): void {
  if (!p) return;
  const pets = roster.pets.slice();
  if (pets.length === 0) pets.push(p);
  else pets[roster.active] = p;
  roster = { ...roster, pets };
  persist();
}

export interface Toast {
  id: number;
  note: CareResult["note"] | "tooTired" | "asleepTap" | "learned" | "saved";
}

export interface Daily {
  day: string;
  fed: boolean;
  played: boolean;
  cleaned: boolean;
  petted: boolean;
}

interface GameState {
  /** the pet on screen */
  pet: Pet | null;
  pets: Pet[];
  active: number;
  /** look after another of your pets */
  switchTo: (index: number) => void;
  /** a newborn joins the family and comes on screen */
  adopt: (child: Pet) => boolean;
  /** a little one adopted from the adoption centre joins the roster (plan 4.8) */
  welcome: (p: Pet) => boolean;
  /** replace the active pet after something outside the store changed it (walking, breeding) */
  replace: (p: Pet) => void;
  /** a friend's pet comes to stay (pet-sitting): added to the roster without counting as a new pet of yours */
  guest: (p: Pet) => boolean;
  /** a pet leaves this device (a sat pet going home) */
  release: (bornAt: number) => void;
  toast: Toast | null;
  /** last care for the scene to animate */
  lastCare: { kind: Care["kind"] | "pet" | "learn"; at: number; food?: string } | null;
  daily: Daily;
  hatch: (line: StarterLine, name: string, instincts?: number) => void;
  /** a care action; `art` is the picture of the food or item used, for the room to show */
  act: (c: Care, art?: string) => void;
  tick: () => void;
  /** the last absence long enough to tell about, until the player has seen it */
  away: Away | null;
  clearAway: () => void;
  wakeUp: () => void;
  say: (note: Toast["note"]) => void;
  /** add a lesson; returns why not when refused */
  /** teach a lesson; it goes on top (asked first) unless placed at the bottom */
  learn: (rule: Rule, at?: "top" | "bottom") => { ok: true } | { ok: false; reason: string; detail: string };
  arrange: (index: number, move: "up" | "down" | "forget") => void;
  /** X1: teach an owned circuit as an everyday instinct (ownership is checked by the caller), or forget it */
  teachInstinct: (o: OutsideInstinct) => { ok: true } | { ok: false; reason: "notYours" | "badCircuit" | "tooBig" };
  forgetInstinct: () => void;
  /** levels and skills (plan 4.4): spend XP for a level and a point, take a skill, or forget them all */
  levelUp: () => { ok: true; level: number } | { ok: false; reason: "xp" | "max" };
  learnSkill: (id: number) => { ok: true } | { ok: false; reason: UpgradeRefusal };
  respec: () => void;
}

const todayKey = () => new Date(gameNow()).toDateString();
const freshDaily = (): Daily => ({ day: todayKey(), fed: false, played: false, cleaned: false, petted: false });

/** At least this long away (minutes) before the pet has a "while you were away" to tell. */
const AWAY_STORY_BEATS = 60;

/**
 * Bring a pet up to now after time away: every missed minute runs through its
 * brain, with the small surprises of an absence (see @lingxi/game away.ts).
 */
/** A pet lives by the time zone of the device it is on, as it is now: travel, and its mornings travel with it (P1 S6). */
function zoned(p: Pet): Pet {
  const tz = -new Date(gameNow()).getTimezoneOffset();
  return p.tzOffsetMin === tz ? p : { ...p, tzOffsetMin: tz };
}

function returnTo(p: Pet): { pet: Pet; away: Away | null } {
  // a pet staying with a friend is frozen here until it comes home
  if (p.away) return { pet: p, away: null };
  const now = gameNow();
  const from = p.beat;
  const seed = awaySeed(p);
  const pet = settleForm(catchUp(zoned(p), now, brainOf(p), (b) => awayEvent(seed, b)), now);
  const to = beatOf(now);
  return { pet, away: to - from >= AWAY_STORY_BEATS ? { petKey: String(p.bornAt), from, to } : null };
}

let firstAway: Away | null = null;
function initialPet(): Pet | null {
  const p = roster.pets[roster.active];
  if (!p) return null;
  const r = returnTo(p);
  firstAway = r.away;
  save(r.pet);
  return r.pet;
}

let toastId = 0;

export const useGame = create<GameState>((set, get) => ({
  pet: initialPet(),
  away: firstAway,
  clearAway: () => set({ away: null }),
  pets: roster.pets,
  active: roster.active,
  switchTo: (index) => {
    const target = roster.pets[index];
    if (!target || index === roster.active) return;
    roster = { ...roster, active: index };
    const r = returnTo(target);
    save(r.pet);
    set({ pet: r.pet, pets: roster.pets, active: index, lastCare: null, away: r.away });
  },
  adopt: (child) => {
    if (roster.pets.length >= MAX_PETS) return false;
    roster = { active: roster.pets.length, pets: [...roster.pets, child] };
    persist();
    useBadges.getState().note("pets");
    useBadges.getState().note("children");
    noteEvent("child-born");
    set({ pet: child, pets: roster.pets, active: roster.active, lastCare: null });
    return true;
  },
  replace: (p) => {
    save(p);
    set({ pet: p, pets: roster.pets });
  },
  guest: (p) => {
    if (roster.pets.length >= MAX_PETS || roster.pets.some((x) => x.bornAt === p.bornAt)) return false;
    roster = { active: roster.pets.length, pets: [...roster.pets, p] };
    persist();
    set({ pet: p, pets: roster.pets, active: roster.active, lastCare: null });
    return true;
  },
  welcome: (p) => {
    if (roster.pets.length >= MAX_PETS || roster.pets.some((x) => x.bornAt === p.bornAt)) return false;
    roster = { active: roster.pets.length, pets: [...roster.pets, p] };
    persist();
    useBadges.getState().note("pets");
    noteEvent("adopted");
    set({ pet: p, pets: roster.pets, active: roster.active, lastCare: null });
    return true;
  },
  release: (bornAt) => {
    const pets = roster.pets.filter((x) => x.bornAt !== bornAt);
    if (pets.length === roster.pets.length) return;
    const active = Math.min(roster.active, Math.max(0, pets.length - 1));
    roster = { active, pets };
    persist();
    set({ pet: pets[active] ? returnTo(pets[active]!).pet : null, pets, active, lastCare: null });
  },
  toast: null,
  lastCare: null,
  daily: freshDaily(),
  hatch: (line, name, instincts = 0) => {
    const pet = createPet({
      name: name.trim().slice(0, 12) || "Mochi",
      line,
      now: gameNow(),
      tzOffsetMin: -new Date(gameNow()).getTimezoneOffset(),
      brain: brainFor(line, [], instincts),
      instincts,
    });
    save(pet);
    useBadges.getState().note("pets");
    set({ pet, pets: roster.pets, daily: freshDaily() });
  },
  act: (c, art) => {
    const { pet } = get();
    if (!pet || pet.away) return;
    const cleanBefore = Math.floor(pet.meters.clean / 60);
    const r = care(pet, c, gameNow(), brainOf(pet));
    save(r.pet);
    // cleaning up after a messy pet leaves compost for the garden (C4)
    if (c.kind === "clean" && r.note === "cleaned") void import("./world").then((m) => m.useWorld.getState().compost(cleanBefore));
    countCare(c.kind, pet.asleep, r);
    set({
      pet: r.pet,
      pets: roster.pets,
      lastCare: { kind: c.kind === "use" ? "feed" : c.kind, at: performance.now(), ...(foodArt(c, art) ? { food: foodArt(c, art)! } : {}) },
      toast: { id: ++toastId, note: r.note },
    });
  },
  tick: () => {
    const { pet } = get();
    if (!pet || pet.away) return;
    // a tab left hidden for a while comes back like any return, surprises included
    if (beatOf(gameNow()) - pet.beat > 10) return get().wakeUp();
    const next = settleForm(liveBeat(zoned(pet), gameNow(), brainOf(pet)), gameNow());
    if (next !== pet) {
      if (stageOf(next, gameNow()) !== stageOf(pet, gameNow() - 60_000)) useBadges.getState().note("stage", STAGE_RANK[stageOf(next, gameNow())] ?? 0);
      save(next);
      set({ pet: next, pets: roster.pets });
    }
  },
  wakeUp: () => {
    const { pet } = get();
    if (!pet) return;
    const r = returnTo(pet);
    if (r.pet !== pet) {
      save(r.pet);
      set({ pet: r.pet, pets: roster.pets, ...(r.away ? { away: r.away } : {}) });
    }
  },
  say: (note) => set({ toast: { id: ++toastId, note } }),
  learn: (rule, at = "top") => {
    const { pet } = get();
    if (!pet) return { ok: false, reason: "invalid", detail: "no pet" };
    // a pet away cannot learn here, and a friend's pet is only taught by its owner
    if (pet.away || pet.sitting) return { ok: false, reason: "notYours", detail: "only its owner teaches it" };
    const caught = catchUp(pet, gameNow(), brainOf(pet));
    const r = teachRule(caught, rule, gameNow(), questSlots());
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
    if (at === "bottom") for (let i = 0; i < r.pet.lessons.length - 1; i++) r.pet = arrangeLessons(r.pet, i, "down");
    // one live beat with "talk" on the pins, so the new mind answers at once
    const after = care(r.pet, { kind: "talk" }, gameNow(), brainOf(r.pet)).pet;
    save(after);
    set({ pet: after, pets: roster.pets, lastCare: { kind: "learn", at: performance.now() }, toast: { id: ++toastId, note: "learned" } });
    useBadges.getState().note("lessons");
    noteTally("LESSON");
    return { ok: true };
  },
  arrange: (index, move) => {
    const { pet } = get();
    if (!pet) return;
    const next = arrangeLessons(pet, index, move);
    save(next);
    set({ pet: next, pets: roster.pets });
  },
  teachInstinct: (o) => {
    const { pet } = get();
    if (!pet) return { ok: false, reason: "badCircuit" };
    if (pet.away || pet.sitting) return { ok: false, reason: "notYours" };
    const inst = instinctBrain(o);
    if (!inst) return { ok: false, reason: "badCircuit" };
    const caught = catchUp(pet, gameNow(), brainOf(pet));
    const own = brainOf({ ...caught, outside: undefined }).nState;
    if (own + inst.nState > MAX_MIND_STATE) return { ok: false, reason: "tooBig" };
    // the pet's own memory stays; the instinct's starts empty after it
    const taught = withSegment({ ...caught, outside: o, brain: [...caught.brain.slice(0, own), ...new Array(inst.nState).fill(0)] });
    const after = care(taught, { kind: "talk" }, gameNow(), brainOf(taught)).pet;
    save(after);
    set({ pet: after, pets: roster.pets, lastCare: { kind: "learn", at: performance.now() }, toast: { id: ++toastId, note: "learned" } });
    return { ok: true };
  },
  forgetInstinct: () => {
    const { pet } = get();
    if (!pet?.outside || pet.away || pet.sitting) return;
    const caught = catchUp(pet, gameNow(), brainOf(pet));
    const { outside: _gone, ...rest } = caught;
    const own = brainOf(rest as Pet).nState;
    const next = withSegment({ ...(rest as Pet), brain: caught.brain.slice(0, own) });
    save(next);
    set({ pet: next, pets: roster.pets });
  },
  levelUp: () => {
    const pet = get().pet;
    if (!pet) return { ok: false, reason: "xp" };
    const r = levelUpPet(catchUp(pet, gameNow(), brainOf(pet)));
    if (!r.ok) return r;
    save(r.pet);
    set({ pet: r.pet, pets: roster.pets });
    return { ok: true, level: r.level };
  },
  learnSkill: (id) => {
    const pet = get().pet;
    if (!pet) return { ok: false, reason: "noSkill" };
    // the pet is brought up to now on the brain it had, then the skill (which may change that brain) is taken
    const r = learnSkill(catchUp(pet, gameNow(), brainOf(pet)), id);
    if (!r.ok) return r;
    save(r.pet);
    set({ pet: r.pet, pets: roster.pets });
    return { ok: true };
  },
  respec: () => {
    const pet = get().pet;
    if (!pet) return;
    const next = respecPet(catchUp(pet, gameNow(), brainOf(pet)));
    save(next);
    set({ pet: next, pets: roster.pets });
  },
}));
