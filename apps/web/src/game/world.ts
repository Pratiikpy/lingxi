/**
 * The player's world on this device: where the pet is, the bag, coins and
 * quests. Saved in the browser beside the pet. Moving and searching tire the
 * pet; food from the bag goes through the game rules like any care.
 */

import { DECOR_BY_ID, MAX_PLACED, PLACE_AREA, buyDecor as buyDecorRule, placeDecor as placeDecorRule, removeDecor as removeDecorRule, COMPOST, compostFromClean, harvest as harvestRule, plant as plantRule, startWalk as startWalkRule, stepWalk as stepWalkRule, endWalk as endWalkRule, startTrip as startTripRule, endTrip as endTripRule } from "@lingxi/world";
import { useBadges } from "./badges";
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
  give as giveItem,
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

/** Keep only well-formed decorations from storage: known pieces, owned, inside the room, within the cap. */
function cleanDecor(d: unknown): WorldState["decor"] {
  if (!d || typeof d !== "object") return undefined;
  const raw = d as { owned?: unknown; placed?: unknown };
  const owned = Array.isArray(raw.owned) ? [...new Set(raw.owned.filter((x): x is string => typeof x === "string" && x in DECOR_BY_ID))] : [];
  const placed = (Array.isArray(raw.placed) ? raw.placed : [])
    .filter((p): p is { id: string; x: number; y: number } => !!p && typeof p.id === "string" && owned.includes(p.id) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
    .slice(0, MAX_PLACED)
    .map((p) => ({ id: p.id, x: Math.max(PLACE_AREA.x0, Math.min(PLACE_AREA.x1, Math.round(p.x))), y: Math.max(PLACE_AREA.y0, Math.min(PLACE_AREA.y1, Math.round(p.y))) }));
  return { owned, placed };
}

function load(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as WorldState;
      if (w.version === 1) return { ...w, claimed: Array.isArray(w.claimed) ? w.claimed : [], decor: cleanDecor(w.decor) };
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
  kind: "moved" | "found" | "bought" | "made" | "claimed" | "fail" | "opened" | "planted" | "harvested" | "compost";
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
  /** decorations for the home room */
  buyDecor: (id: string) => boolean;
  placeDecor: (id: string, x: number, y: number) => void;
  removeDecor: (id: string) => void;
  /** take items out of the bag to wrap them as a gift; false if there are not enough */
  wrap: (item: number, n: number) => boolean;
  /** put a received gift's item in the bag */
  receive: (item: number, n: number) => void;
  /** the garden (W2) and compost (C4) */
  plant: (plot: number, crop: string, compost: boolean) => void;
  harvest: (plot: number) => void;
  compost: (cleanBefore: number) => void;
  /** walks and trips (W4, W5) */
  startWalk: (sensor: boolean) => void;
  addSteps: (n: number) => void;
  endWalk: () => void;
  startTrip: (to: string) => void;
  endTrip: () => void;
  /** what the last walk or trip came to, for the card that welcomes the pet back */
  lastOuting: { kind: "walk"; steps: number; minutes: number; found: Array<{ item: number; n: number }>; capped: boolean } | { kind: "trip"; to: string; found: Array<{ item: number; n: number }>; learned: number | null } | null;
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
    useBadges.getState().visit(to);
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
    if (def.kind === "food") act({ kind: "feed", food: r.use }, def.art);
    else act({ kind: "use", item: r.use }, def.art);
  },
  openBox: () => {
    const r = openRiverBox(get().world, Date.now());
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "opened", items: r.found } });
  },
  wrap: (item, n) => {
    const w = get().world;
    if ((w.bag[item] ?? 0) < n) return false;
    const next = giveItem(w, item, -n);
    save(next);
    set({ world: next });
    return true;
  },
  plant: (plot, crop, withCompost) => {
    const r = plantRule(get().world, plot, crop, withCompost, Date.now());
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("pop");
    set({ world: r.world, notice: { id: ++n, kind: "planted" } });
  },
  harvest: (plot) => {
    const r = harvestRule(get().world, plot, Date.now());
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    set({ world: r.world, notice: { id: ++n, kind: "harvested", items: [{ item: r.item, n: r.n }] } });
  },
  compost: (cleanBefore) => {
    const r = compostFromClean(get().world, cleanBefore);
    if (!r.made) return;
    save(r.world);
    set({ world: r.world, notice: { id: ++n, kind: "compost", items: [{ item: COMPOST, n: 1 }] } });
  },
  lastOuting: null,
  startWalk: (sensor) => {
    const r = startWalkRule(get().world, Date.now(), sensor);
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    set({ world: r.world, lastOuting: null });
  },
  addSteps: (steps) => {
    const r = stepWalkRule(get().world, steps, Date.now());
    if (!r.ok) return;
    save(r.world);
    if (r.found.length) play("pop");
    set({ world: r.world });
  },
  endWalk: () => {
    const r = endWalkRule(get().world, Date.now());
    if (!r.ok) return;
    save(r.world);
    set({ world: r.world, lastOuting: { kind: "walk", steps: r.steps, minutes: r.minutes, found: r.finds, capped: r.capped } });
    // a walk together is play: joy for the pet, and it tires
    if (r.minutes >= 5) useGame.getState().act({ kind: "play" });
  },
  startTrip: (to) => {
    const r = startTripRule(get().world, to, Date.now());
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    set({ world: r.world, lastOuting: null });
  },
  endTrip: () => {
    const r = endTripRule(get().world, Date.now());
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    set({ world: r.world, lastOuting: { kind: "trip", to: r.to, found: r.found, learned: r.learned } });
  },
  receive: (item, n) => {
    if (!ITEM[item]) return;
    const next = giveItem(get().world, item, n);
    save(next);
    set({ world: next });
  },
  buyDecor: (id) => {
    const r = buyDecorRule(get().world, id);
    if (!r.ok) {
      play("error");
      set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
      return false;
    }
    save(r.world);
    play("success");
    set({ world: r.world });
    return true;
  },
  placeDecor: (id, x, y) => {
    const r = placeDecorRule(get().world, id, x, y);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("pop");
    set({ world: r.world });
  },
  removeDecor: (id) => {
    const r = removeDecorRule(get().world, id);
    if (!r.ok) return;
    save(r.world);
    play("tap");
    set({ world: r.world });
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
