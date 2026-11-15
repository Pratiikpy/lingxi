/**
 * The game on this device: the pet, its compiled brain, and the guest save.
 * Progress lives in the browser (guest play); connecting a wallet later keeps
 * the same pet and starts writing daily checkpoints on chain.
 */

import { create } from "zustand";
import { STARTERS, type StarterLine, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { type Brain, type Care, type CareResult, type Pet, care, catchUp, createPet, liveBeat } from "@lingxi/game";

const SAVE_KEY = "lingxi.pet.v1";

const brains = new Map<StarterLine, Brain>();
export function brainFor(line: StarterLine): Brain {
  let b = brains.get(line);
  if (!b) {
    const p = STARTERS[line];
    b = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
    brains.set(line, b);
  }
  return b;
}

function load(): Pet | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pet;
    if (p.version !== 1 || !STARTERS[p.line]) return null;
    return p;
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
  note: CareResult["note"] | "tooTired" | "asleepTap";
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
  lastCare: { kind: Care["kind"] | "pet"; at: number; food?: string } | null;
  daily: Daily;
  hatch: (line: StarterLine, name: string) => void;
  act: (c: Care) => void;
  tick: () => void;
  wakeUp: () => void;
  say: (note: Toast["note"]) => void;
}

const todayKey = () => new Date().toDateString();
const freshDaily = (): Daily => ({ day: todayKey(), fed: false, played: false, cleaned: false, petted: false });

function initialPet(): Pet | null {
  const p = load();
  if (!p) return null;
  const caught = catchUp(p, Date.now(), brainFor(p.line));
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
    const r = care(pet, c, Date.now(), brainFor(pet.line));
    save(r.pet);
    const d = get().daily.day === todayKey() ? { ...get().daily } : freshDaily();
    if (c.kind === "feed" && r.note !== "overfed") d.fed = true;
    if (c.kind === "play" && r.note === "played") d.played = true;
    if (c.kind === "clean") d.cleaned = true;
    if (c.kind === "pet") d.petted = true;
    set({
      pet: r.pet,
      daily: d,
      lastCare: { kind: c.kind, at: performance.now(), ...(c.kind === "feed" ? { food: c.food } : {}) },
      toast: { id: ++toastId, note: r.note },
    });
  },
  tick: () => {
    const { pet } = get();
    if (!pet) return;
    const next = liveBeat(pet, Date.now(), brainFor(pet.line));
    if (next !== pet) {
      save(next);
      set({ pet: next });
    }
  },
  wakeUp: () => {
    const { pet } = get();
    if (!pet) return;
    const caught = catchUp(pet, Date.now(), brainFor(pet.line));
    if (caught !== pet) {
      save(caught);
      set({ pet: caught });
    }
  },
  say: (note) => set({ toast: { id: ++toastId, note } }),
}));
