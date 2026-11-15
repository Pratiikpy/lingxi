/**
 * The game on this device: the pet, its compiled brain, and the guest save.
 * Progress lives in the browser (guest play); connecting a wallet later keeps
 * the same pet and starts writing daily checkpoints on chain.
 */

import { CARE_METRIC, useBadges } from "./badges";

/** The picture of what was eaten: the item's own art, or the starter food's. */
function foodArt(c: Care, art?: string): string | undefined {
  if (art) return art;
  return c.kind === "feed" && typeof c.food === "string" ? FOODS.find((f) => f.id === c.food)?.art : undefined;
}

/** Stage as the "Growing up" badge counts it: child 2, teen 3, adult 4. */
const STAGE_RANK: Record<string, number> = { baby: 1, child: 2, teen: 3, adult: 4, elder: 4 };
import { create } from "zustand";
import { type Program, type Rule, STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { FOODS, type Brain, type Care, type CareResult, type Pet, arrangeLessons, care, catchUp, composeProgram, createPet, halvesOf, kinshipNow, liveBeat, mindBrain, settleForm, stageOf, teach as teachRule, awayEvent, awaySeed, beatOf } from "@lingxi/game";
import type { StarterLine } from "@lingxi/brain";

const OLD_KEY = "lingxi.pet.v1";
const SAVE_KEY = "lingxi.pets.v2";
/** the most pets one player keeps on this device */
export const MAX_PETS = 8;

/** An absence: which pet, and the beats it spanned. */
export interface Away {
  petKey: string;
  from: number;
  to: number;
}

const brains = new Map<string, Brain>();
/** The pet's whole program: what it was taught, then the instincts it hatched with, then its egg line's starter rules. */
export function programFor(line: StarterLine, lessons: readonly Rule[] = [], instincts = 0): Program {
  return lessons.length || instincts ? composeProgram(line, lessons, instincts) : STARTERS[line];
}
export function brainFor(line: StarterLine, lessons: readonly Rule[] = [], instincts = 0): Brain {
  const key = line + instincts + JSON.stringify(lessons);
  let b = brains.get(key);
  if (!b) {
    const p = programFor(line, lessons, instincts);
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
  if (!pet.family) return [{ program: programFor(pet.line, pet.lessons, pet.instincts), offset: 0 }];
  const [a, b] = halvesOf(pet.family, pet.lessons);
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
export const brainOf = (p: Pet): Brain => (p.family ? mindBrain({ line: p.line, lessons: p.lessons ?? [], family: p.family }) : brainFor(p.line, p.lessons ?? [], p.instincts ?? 0));

interface Roster {
  active: number;
  pets: Pet[];
}

const valid = (p: Pet | null | undefined): p is Pet => !!p && p.version === 1 && !!STARTERS[p.line];
const tidy = (p: Pet): Pet => ({ ...p, lessons: Array.isArray(p.lessons) ? p.lessons : [] });

function loadRoster(): Roster {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Roster;
      const pets = (Array.isArray(r.pets) ? r.pets : []).filter(valid).map(tidy).slice(0, MAX_PETS);
      return { active: Math.min(Math.max(0, r.active | 0), Math.max(0, pets.length - 1)), pets };
    }
    // a save from before families: one pet becomes the first of the roster
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const p = JSON.parse(old) as Pet;
      if (valid(p)) return { active: 0, pets: [tidy(p)] };
    }
  } catch {
    // unreadable save: start fresh rather than crash
  }
  return { active: 0, pets: [] };
}

let roster: Roster = loadRoster();

function persist(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(roster));
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
}

const todayKey = () => new Date().toDateString();
const freshDaily = (): Daily => ({ day: todayKey(), fed: false, played: false, cleaned: false, petted: false });

/** At least this long away (minutes) before the pet has a "while you were away" to tell. */
const AWAY_STORY_BEATS = 60;

/**
 * Bring a pet up to now after time away: every missed minute runs through its
 * brain, with the small surprises of an absence (see @lingxi/game away.ts).
 */
function returnTo(p: Pet): { pet: Pet; away: Away | null } {
  // a pet staying with a friend is frozen here until it comes home
  if (p.away) return { pet: p, away: null };
  const now = Date.now();
  const from = p.beat;
  const seed = awaySeed(p);
  const pet = settleForm(catchUp(p, now, brainOf(p), (b) => awayEvent(seed, b)), now);
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
      now: Date.now(),
      tzOffsetMin: -new Date().getTimezoneOffset(),
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
    const r = care(pet, c, Date.now(), brainOf(pet));
    save(r.pet);
    const metric = CARE_METRIC[r.note];
    if (metric) {
      const b = useBadges.getState();
      b.note("care");
      b.note(metric);
      b.note("kinship", kinshipNow(r.pet, r.pet.beat));
      b.note("stage", STAGE_RANK[stageOf(r.pet, Date.now())] ?? 0);
    }
    const d = get().daily.day === todayKey() ? { ...get().daily } : freshDaily();
    if (c.kind === "feed" && r.note !== "overfed") d.fed = true;
    if (c.kind === "play" && r.note === "played") d.played = true;
    if (c.kind === "clean") d.cleaned = true;
    if (c.kind === "pet") d.petted = true;
    set({
      pet: r.pet,
      pets: roster.pets,
      daily: d,
      lastCare: { kind: c.kind === "use" ? "feed" : c.kind, at: performance.now(), ...(foodArt(c, art) ? { food: foodArt(c, art)! } : {}) },
      toast: { id: ++toastId, note: r.note },
    });
  },
  tick: () => {
    const { pet } = get();
    if (!pet || pet.away) return;
    // a tab left hidden for a while comes back like any return, surprises included
    if (beatOf(Date.now()) - pet.beat > 10) return get().wakeUp();
    const next = settleForm(liveBeat(pet, Date.now(), brainOf(pet)), Date.now());
    if (next !== pet) {
      if (stageOf(next, Date.now()) !== stageOf(pet, Date.now() - 60_000)) useBadges.getState().note("stage", STAGE_RANK[stageOf(next, Date.now())] ?? 0);
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
    const caught = catchUp(pet, Date.now(), brainOf(pet));
    const r = teachRule(caught, rule, Date.now());
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
    if (at === "bottom") for (let i = 0; i < r.pet.lessons.length - 1; i++) r.pet = arrangeLessons(r.pet, i, "down");
    // one live beat with "talk" on the pins, so the new mind answers at once
    const after = care(r.pet, { kind: "talk" }, Date.now(), brainOf(r.pet)).pet;
    save(after);
    set({ pet: after, pets: roster.pets, lastCare: { kind: "learn", at: performance.now() }, toast: { id: ++toastId, note: "learned" } });
    useBadges.getState().note("lessons");
    return { ok: true };
  },
  arrange: (index, move) => {
    const { pet } = get();
    if (!pet) return;
    const next = arrangeLessons(pet, index, move);
    save(next);
    set({ pet: next, pets: roster.pets });
  },
}));
