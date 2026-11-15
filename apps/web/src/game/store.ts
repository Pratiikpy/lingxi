/**
 * The game on this device: the pet, its compiled brain, and the guest save.
 * Progress lives in the browser (guest play); connecting a wallet later keeps
 * the same pet and starts writing daily checkpoints on chain.
 */

import { create } from "zustand";
import { type Program, type Rule, STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { type Brain, type Care, type CareResult, type Pet, arrangeLessons, care, catchUp, composeProgram, createPet, liveBeat, teach as teachRule } from "@lingxi/game";
import type { StarterLine } from "@lingxi/brain";

const SAVE_KEY = "lingxi.pet.v1";

const brains = new Map<string, Brain>();
/** The pet's whole program: what it was taught, then its instincts. */
export function programFor(line: StarterLine, lessons: readonly Rule[] = []): Program {
  return lessons.length ? composeProgram(line, lessons) : STARTERS[line];
}
export function brainFor(line: StarterLine, lessons: readonly Rule[] = []): Brain {
  const key = line + JSON.stringify(lessons);
  let b = brains.get(key);
  if (!b) {
    const p = programFor(line, lessons);
    b = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
    brains.set(key, b);
  }
  return b;
}
const brainOf = (p: Pet) => brainFor(p.line, p.lessons ?? []);

function load(): Pet | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pet;
    if (p.version !== 1 || !STARTERS[p.line]) return null;
    return { ...p, lessons: Array.isArray(p.lessons) ? p.lessons : [] };
  } catch {
    return null;
  }
}

function save(p: Pet | null): void {
  try {
    if (p) localStorage.setItem(SAVE_KEY, JSON.stringify(p));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // storage full or blocked: the pet keeps living in memory for this visit
  }
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
  pet: Pet | null;
  toast: Toast | null;
  /** last care for the scene to animate */
  lastCare: { kind: Care["kind"] | "pet" | "learn"; at: number; food?: string } | null;
  daily: Daily;
  hatch: (line: StarterLine, name: string) => void;
  act: (c: Care) => void;
  tick: () => void;
  wakeUp: () => void;
  say: (note: Toast["note"]) => void;
  /** add a lesson; returns why not when refused */
  learn: (rule: Rule) => { ok: true } | { ok: false; reason: string; detail: string };
  arrange: (index: number, move: "up" | "down" | "forget") => void;
}

const todayKey = () => new Date().toDateString();
const freshDaily = (): Daily => ({ day: todayKey(), fed: false, played: false, cleaned: false, petted: false });

function initialPet(): Pet | null {
  const p = load();
  if (!p) return null;
  const caught = catchUp(p, Date.now(), brainOf(p));
  save(caught);
  return caught;
}

let toastId = 0;

export const useGame = create<GameState>((set, get) => ({
  pet: initialPet(),
  toast: null,
  lastCare: null,
  daily: freshDaily(),
  hatch: (line, name) => {
    const pet = createPet({
      name: name.trim().slice(0, 12) || "Mochi",
      line,
      now: Date.now(),
      tzOffsetMin: -new Date().getTimezoneOffset(),
      brain: brainFor(line),
    });
    save(pet);
    set({ pet, daily: freshDaily() });
  },
  act: (c) => {
    const { pet } = get();
    if (!pet) return;
    const r = care(pet, c, Date.now(), brainOf(pet));
    save(r.pet);
    const d = get().daily.day === todayKey() ? { ...get().daily } : freshDaily();
    if (c.kind === "feed" && r.note !== "overfed") d.fed = true;
    if (c.kind === "play" && r.note === "played") d.played = true;
    if (c.kind === "clean") d.cleaned = true;
    if (c.kind === "pet") d.petted = true;
    set({
      pet: r.pet,
      daily: d,
      lastCare: { kind: c.kind === "use" ? "feed" : c.kind, at: performance.now() },
      toast: { id: ++toastId, note: r.note },
    });
  },
  tick: () => {
    const { pet } = get();
    if (!pet) return;
    const next = liveBeat(pet, Date.now(), brainOf(pet));
    if (next !== pet) {
      save(next);
      set({ pet: next });
    }
  },
  wakeUp: () => {
    const { pet } = get();
    if (!pet) return;
    const caught = catchUp(pet, Date.now(), brainOf(pet));
    if (caught !== pet) {
      save(caught);
      set({ pet: caught });
    }
  },
  say: (note) => set({ toast: { id: ++toastId, note } }),
  learn: (rule) => {
    const { pet } = get();
    if (!pet) return { ok: false, reason: "invalid", detail: "no pet" };
    const caught = catchUp(pet, Date.now(), brainOf(pet));
    const r = teachRule(caught, rule, Date.now());
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
    // one live beat with "talk" on the pins, so the new mind answers at once
    const after = care(r.pet, { kind: "talk" }, Date.now(), brainOf(r.pet)).pet;
    save(after);
    set({ pet: after, lastCare: { kind: "learn", at: performance.now() }, toast: { id: ++toastId, note: "learned" } });
    return { ok: true };
  },
  arrange: (index, move) => {
    const { pet } = get();
    if (!pet) return;
    const next = arrangeLessons(pet, index, move);
    save(next);
    set({ pet: next });
  },
}));
