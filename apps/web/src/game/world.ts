/**
 * The player's world on this device: where the pet is, the bag, coins and
 * quests. Saved in the browser beside the pet. Moving and searching tire the
 * pet; food from the bag goes through the game rules like any care.
 */

import { create } from "zustand";
import { exert, stageOf } from "@lingxi/game";
import {
  FORAGE_ENERGY,
  ITEM,
  MOVE_ENERGY,
  type WorldState,
  buy as buyItem,
  claim as claimQuest,
  craft as craftRecipe,
  earn,
  forage as forageHere,
  move as moveTo,
  newWorld,
  openBox as openRiverBox,
  take,
} from "@lingxi/world";
import { useChain } from "./chain";
import { brainOf, useGame } from "./store";
import { play } from "./sound";

const KEY = "lingxi.world.v1";

function load(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as WorldState;
      if (w.version === 1) return { ...w, claimed: Array.isArray(w.claimed) ? w.claimed : [] };
    }
  } catch {
    // fall through to a new world
  }
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  return newWorld(seed);
}

function save(w: WorldState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // keeps working in memory
  }
}

export interface WorldNotice {
  id: number;
  kind: "moved" | "found" | "bought" | "made" | "claimed" | "fail" | "opened";
  text?: string;
  items?: Array<{ item: number; n: number }>;
  reason?: string;
  coins?: number;
}

interface WorldStore {
  world: WorldState;
  notice: WorldNotice | null;
  move: (to: number) => boolean;
  forage: () => void;
  buy: (item: number) => void;
  craft: (recipe: number) => void;
  use: (item: number) => void;
  openBox: () => void;
  claim: (id: string) => void;
  /** coins won outside the world (spars) */
  reward: (coins: number) => void;
}

let n = 0;
const petEnergy = () => {
  const p = useGame.getState().pet;
  return p ? Math.floor(p.meters.energy / 60) : 0;
};

function tirePet(energy: number): void {
  const g = useGame.getState();
  const p = g.pet;
  if (!p) return;
  g.replace(exert(p, energy, Date.now(), brainOf(p)));
}

export const useWorld = create<WorldStore>((set, get) => ({
  world: load(),
  notice: null,
  move: (to) => {
    const p = useGame.getState().pet;
    if (p?.asleep) {
      set({ notice: { id: ++n, kind: "fail", reason: "asleep" } });
      return false;
    }
    const r = moveTo(get().world, to, petEnergy());
    if (!r.ok) {
      play("error");
      set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
      return false;
    }
    tirePet(MOVE_ENERGY);
    save(r.world);
    play("tap");
    set({ world: r.world, notice: { id: ++n, kind: "moved", coins: r.coins } });
    return true;
  },
  forage: () => {
    const r = forageHere(get().world, Date.now(), petEnergy());
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    tirePet(FORAGE_ENERGY);
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "found", items: r.found } });
  },
  buy: (item) => {
    const r = buyItem(get().world, item);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("pop");
    set({ world: r.world, notice: { id: ++n, kind: "bought", items: [{ item, n: 1 }] } });
  },
  craft: (recipe) => {
    const r = craftRecipe(get().world, recipe);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "made", items: [{ item: r.made, n: 1 }] } });
  },
  use: (item) => {
    const def = ITEM[item];
    const r = take(get().world, item);
    if (!def || !r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.ok ? "cantUse" : r.reason } });
    }
    save(r.world);
    set({ world: r.world });
    const act = useGame.getState().act;
    if (def.kind === "food") act({ kind: "feed", food: r.use });
    else act({ kind: "use", item: r.use });
  },
  openBox: () => {
    const r = openRiverBox(get().world, Date.now());
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "opened", items: r.found } });
  },
  reward: (coins) => {
    const w = earn(get().world, coins);
    save(w);
    set({ world: w });
  },
  claim: (id) => {
    const p = useGame.getState().pet;
    if (!p) return;
    const r = claimQuest(get().world, id, { counts: p.counts, stage: stageOf(p, Date.now()), onChain: useChain.getState().record !== null });
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "claimed", coins: r.coins, items: r.items } });
  },
}));
