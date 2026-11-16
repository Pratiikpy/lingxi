/**
 * The player's world on this device: where the pet is, the bag, coins and
 * quests. Saved in the browser beside the pet. Moving and searching tire the
 * pet; food from the bag goes through the game rules like any care.
 */

import { DECOR_BY_ID, MAX_PLACED, PLACE_AREA, buyDecor as buyDecorRule, placeDecor as placeDecorRule, removeDecor as removeDecorRule, COMPOST, compostFromClean, harvest as harvestRule, plant as plantRule, startWalk as startWalkRule, stepWalk as stepWalkRule, endWalk as endWalkRule, startTrip as startTripRule, endTrip as endTripRule, make as makeRule, buyPiece as buyPieceRule, wear as wearRule, giveLaurel as giveLaurelRule } from "@lingxi/world";
import { useBadges } from "./badges";
import { create } from "zustand";
import { wearableOf } from "@lingxi/art";
import { useDesigns } from "./designs";
import { exert, work, localHour, needsMinOf, stageOf, exploreMods } from "@lingxi/game";
import { WANTS, timeOfDay } from "@lingxi/brain";
import {
  ITEM,
  type WorldState,
  buy as buyItem,
  claim as claimQuest,
  craft as craftRecipe,
  earn,
  give as giveItem,
  forage as forageHere,
  move as moveTo,
  newWorld,
  openBox as openBoxRule,
  affinitiesOf,
  spendSparBuffs,
  take,
  backfillTally,
  bump,
  giveTo as giveToRule,
  withFlag,
  HOME,
  INDOOR_ROOMS,
  TIMES_OF_DAY,
  localDay,
  outfitOf,
} from "@lingxi/world";
import { setTallySink } from "./tally";
import { PROOF_KEY, takeProofChecks } from "./proofMark";
import { useChain } from "./chain";
import { brainOf, useGame } from "./store";
import { play } from "./sound";

const KEY = "lingxi.world.v1";

/** Keep only well-formed decorations from storage: known pieces, owned, inside the room, within the cap. */
function cleanDecor(d: unknown): WorldState["decor"] {
  if (!d || typeof d !== "object") return undefined;
  const raw = d as { owned?: unknown; placed?: unknown; chainHeld?: unknown };
  // on-chain pieces are never owned by the game, only held on chain (read again from X Layer on start)
  const owned = Array.isArray(raw.owned) ? [...new Set(raw.owned.filter((x): x is string => typeof x === "string" && x in DECOR_BY_ID && !DECOR_BY_ID[x]!.chain))] : [];
  const chainHeld = Array.isArray(raw.chainHeld) ? [...new Set(raw.chainHeld.filter((x): x is string => typeof x === "string" && !!DECOR_BY_ID[x]?.chain))] : [];
  const placed = (Array.isArray(raw.placed) ? raw.placed : [])
    .filter((p): p is { id: string; x: number; y: number } => !!p && typeof p.id === "string" && (owned.includes(p.id) || chainHeld.includes(p.id)) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
    .slice(0, MAX_PLACED)
    .map((p) => ({ id: p.id, x: Math.max(PLACE_AREA.x0, Math.min(PLACE_AREA.x1, Math.round(p.x))), y: Math.max(PLACE_AREA.y0, Math.min(PLACE_AREA.y1, Math.round(p.y))) }));
  return chainHeld.length ? { owned, placed, chainHeld } : { owned, placed };
}

/** Only whole, non-negative counts under well-formed keys survive a reload. */
function cleanTally(t: unknown): Record<string, number> {
  if (!t || typeof t !== "object") return {};
  return Object.fromEntries(Object.entries(t as Record<string, unknown>).filter((e): e is [string, number] => /^[A-Z_]{2,24}:[\w:-]{1,40}$/.test(e[0]) && Number.isSafeInteger(e[1]) && (e[1] as number) >= 0));
}

/** Bonuses and familiarity from storage: small whole numbers only, so an edited save cannot mint a huge bonus. */
function cleanCounts<K extends string>(o: unknown, keyOk: (k: string) => boolean, max: number): Partial<Record<K, number>> | undefined {
  if (!o || typeof o !== "object") return undefined;
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter((e): e is [K, number] => keyOk(e[0]) && Number.isSafeInteger(e[1]) && (e[1] as number) >= 0 && (e[1] as number) <= max)) as Partial<Record<K, number>>;
}
const BUFF_KEYS = ["forageExtra", "sparPower", "sparHp", "sparLossCoins"];

const cleanFlags = (f: unknown): string[] => (Array.isArray(f) ? [...new Set(f.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x)))] : []);

function load(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as WorldState;
      if (w.version === 1) {
        const clean: WorldState = {
          ...w,
          claimed: Array.isArray(w.claimed) ? w.claimed : [],
          decor: cleanDecor(w.decor),
          tally: cleanTally(w.tally),
          flags: cleanFlags(w.flags),
          buffs: cleanCounts(w.buffs, (k) => BUFF_KEYS.includes(k), 500),
          familiar: cleanCounts(w.familiar, (k) => /^\d{1,4}$/.test(k), 100) as WorldState["familiar"],
        };
        // a save from before tools (plan 4.5) that already took the pebbles gets the screwdriver that quest now gives, once
        const tooled = clean.claimed.includes("q07") && !(clean.flags ?? []).includes("tools-given") && !(clean.bag[23102] ?? 0) ? withFlag(giveItem(clean, 23102, 1), "tools-given") : clean;
        // an older save is counted into the tally once, from what it and the badge ledger already record
        const counted = backfillTally(tooled, useBadges.getState().ledger);
        if (counted !== clean) save(counted);
        return counted;
      }
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
  kind: "moved" | "found" | "bought" | "made" | "claimed" | "fail" | "opened" | "planted" | "harvested" | "compost" | "sewn" | "built" | "readied";
  text?: string;
  items?: Array<{ item: number; n: number }>;
  reason?: string;
  coins?: number;
  /** a look around that filled the room's familiarity bar and showed its secret find */
  secret?: boolean;
  /** experience the pet earned at the bench */
  xp?: number;
}

interface WorldStore {
  world: WorldState;
  notice: WorldNotice | null;
  move: (to: number) => boolean;
  forage: () => void;
  buy: (item: number) => void;
  craft: (recipe: number) => void;
  use: (item: number) => void;
  openBox: (box?: number) => void;
  /** the bonuses waiting for the next spar, spent as it starts (plan 4.5) */
  spendSparBuffs: () => { power: number; hp: number; lossCoins: number };
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
  /** the wardrobe (S4, W6, M3) */
  make: (kind: "outfit" | "furniture", id: string) => void;
  buyPiece: (id: string) => void;
  wear: (petKey: string, slot: "head" | "face" | "held", id: string | null) => void;
  giveLaurel: () => void;
  /** walks and trips (W4, W5) */
  startWalk: (sensor: boolean) => void;
  addSteps: (n: number) => void;
  endWalk: () => void;
  startTrip: (to: string) => void;
  endTrip: () => void;
  /** a pet's event counted into the player's lifetime tally (plan 4.1): care, lessons, spars, saves, choices */
  tally: (type: string, index: number | string, n: number, opts?: { total?: boolean }) => void;
  /** replace the world with one a pure rule returned (quests use it); saved at once */
  setWorld: (next: WorldState) => void;
  /** a named fact that happened once (FLAG conditions) */
  flag: (name: string) => void;
  /** hand items to a resident (quests ask for gifts) */
  giveTo: (resident: string, item: number, n: number) => boolean;
  /** use up items that act outside the pet's meters (the Fresh Start Tea); false when there are not enough */
  consume: (item: number, n?: number) => boolean;
  /** what the last walk or trip came to, for the card that welcomes the pet back */
  lastOuting: { kind: "walk"; steps: number; minutes: number; found: Array<{ item: number; n: number }>; capped: boolean } | { kind: "trip"; to: string; found: Array<{ item: number; n: number }>; learned: number | null } | null;
}

let n = 0;
const petEnergy = () => {
  const p = useGame.getState().pet;
  return p ? Math.floor(p.meters.energy / 60) : 0;
};
/** The world's numbers for the pet on screen: its Explore skills change them (plan 4.4). */
const petMods = () => exploreMods(useGame.getState().pet?.growth);

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
    const mods = petMods();
    const r = moveTo(get().world, to, petEnergy(), mods);
    if (!r.ok) {
      play("error");
      set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
      return false;
    }
    tirePet(mods.moveEnergy);
    // a walk taken wearing something ("visit three rooms carrying a lantern"); market ids keep to one word
    let moved = r.world;
    if (p) for (const piece of Object.values(outfitOf(moved, String(p.bornAt)))) if (piece) moved = bump(moved, "MOVE_WEARING", piece.replace(/:/g, "-"));
    save(moved);
    useBadges.getState().visit(to);
    play("tap");
    set({ world: moved, notice: { id: ++n, kind: "moved", coins: r.coins } });
    return true;
  },
  forage: () => {
    const mods = petMods();
    const p = useGame.getState().pet;
    // at home where its kind lives: twice the familiarity (brave pets are at home in eerie places too)
    const kin = p ? affinitiesOf(p.line, ((p.instincts ?? 0) & 1) === 1) : [];
    const r = forageHere(get().world, Date.now(), petEnergy(), mods, kin);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    tirePet(mods.forageEnergy);
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "found", items: r.found, ...(r.familiar?.filled ? { secret: true } : {}) } });
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
    const g = useGame.getState();
    if (g.pet?.asleep) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: "asleep" } });
    }
    const r = craftRecipe(get().world, recipe, petEnergy());
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    // the work tires the pet and teaches it (plan 4.5)
    const p = g.pet;
    if (p) g.replace(work(p, r.energy, r.xp, Date.now(), brainOf(p)));
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "made", items: [{ item: r.made, n: 1 }], xp: r.xp } });
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
    const g = useGame.getState();
    const before = g.toast?.id;
    // a bonus-only item (a jewel, a tonic) waits for the next look around or spar; the pet itself is not touched
    if (r.buff && !def.use) {
      play("pop");
      return set({ notice: { id: ++n, kind: "readied", items: [{ item, n: 1 }] } });
    }
    if (def.kind === "food") g.act({ kind: "feed", food: r.use }, def.art);
    else g.act({ kind: "use", item: r.use }, def.art);
    // a food the pet actually ate: which one, and its food group today (for "three foods", "a balanced plate")
    const after = useGame.getState();
    if (def.kind === "food" && after.pet && after.toast && after.toast.id !== before && (after.toast.note === "ate" || after.toast.note === "woke")) {
      get().tally("FED", String(item), 1);
      if (r.use.diet) get().tally("FED_GROUP", `${localDay(Date.now(), after.pet.tzOffsetMin)}-${r.use.diet}`, 1, { total: false });
    }
  },
  openBox: (box = 21007) => {
    const r = openBoxRule(get().world, Date.now(), box);
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "opened", items: r.found } });
  },
  spendSparBuffs: () => {
    const r = spendSparBuffs(get().world);
    if (r.power || r.hp || r.lossCoins) {
      save(r.world);
      set({ world: r.world });
    }
    return { power: r.power, hp: r.hp, lossCoins: r.lossCoins };
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
  make: (kind, id) => {
    const r = makeRule(get().world, kind, id);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: kind === "outfit" ? "sewn" : "built", text: id } });
  },
  buyPiece: (id) => {
    const r = buyPieceRule(get().world, id);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("pop");
    set({ world: r.world, notice: { id: ++n, kind: "sewn", text: id } });
  },
  wear: (petKey, slot, id) => {
    // a player-made piece must be one this player may wear, in the slot it was drawn for
    if (id && /^(u|c2?):/.test(id) && (!useDesigns.getState().canWear(id) || wearableOf(id)?.slot !== slot)) return;
    const r = wearRule(get().world, petKey, slot, id);
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    play("pop");
    set({ world: r.world });
  },
  tally: (type, index, count, opts = {}) => {
    const next = bump(get().world, type, index, count, opts);
    if (next === get().world) return;
    save(next);
    set({ world: next });
  },
  setWorld: (next) => {
    if (next === get().world) return;
    save(next);
    set({ world: next });
  },
  flag: (name) => {
    const next = withFlag(get().world, name);
    if (next === get().world) return;
    save(next);
    set({ world: next });
  },
  consume: (item, count = 1) => {
    const w = get().world;
    if ((w.bag[item] ?? 0) < count) return false;
    const bag = { ...w.bag, [item]: w.bag[item]! - count };
    if (bag[item]! <= 0) delete bag[item];
    const next = { ...w, bag };
    save(next);
    set({ world: next });
    return true;
  },
  giveTo: (resident, item, count) => {
    const r = giveToRule(get().world, resident, item, count);
    if (!r.ok) {
      play("error");
      set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
      return false;
    }
    save(r.world);
    play("pop");
    set({ world: r.world });
    return true;
  },
  giveLaurel: () => {
    const next = giveLaurelRule(get().world);
    if (next === get().world) return;
    save(next);
    set({ world: next, notice: { id: ++n, kind: "sewn", text: "laurel" } });
  },
  lastOuting: null,
  startWalk: (sensor) => {
    const r = startWalkRule(get().world, Date.now(), sensor);
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    set({ world: r.world, lastOuting: null });
  },
  addSteps: (steps) => {
    const r = stepWalkRule(get().world, steps, Date.now(), petMods());
    if (!r.ok) return;
    save(r.world);
    if (r.found.length) play("pop");
    set({ world: r.world });
  },
  endWalk: () => {
    const r = endWalkRule(get().world, Date.now(), petMods());
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
    const r = endTripRule(get().world, Date.now(), petMods());
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

// the pet's events (care, lessons, spars, saves) are counted into the tally the world store owns
setTallySink((type, index, count, opts) => useWorld.getState().tally(type, index, count, opts));

// a saved day checked on the proof page, here or in another tab (see proofMark.ts)
const takeProof = () => {
  const n = takeProofChecks();
  if (n) useWorld.getState().tally("EVENT", "proof-checked", n);
};
takeProof();
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === PROOF_KEY && takeProof());

/**
 * Time together and the pet's own choices (plan 4.1): each live beat (one minute) the pet spends awake with the
 * game open and in view counts as a minute TOGETHER in the current room, and as TOGETHER_NIGHT by its local night;
 * what its brain chose that beat counts as CHOOSE:<want>. A long gap is an absence, not time together.
 */
useGame.subscribe((s, prev) => {
  const p = s.pet;
  const q = prev.pet;
  if (!p || !q || p.bornAt !== q.bornAt || p.beat <= q.beat || p.beat - q.beat > 2) return;
  if (p.away || p.sitting || p.asleep || p.hibernating) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const beats = p.beat - q.beat;
  const w = useWorld.getState();
  const room = w.world.room;
  const time = TIMES_OF_DAY[timeOfDay(localHour(p, p.beat))]!;
  const where = INDOOR_ROOMS.has(room) || room === HOME ? "inside" : "outside";
  w.tally("TOGETHER", room, beats);
  if (time === "night") w.tally("TOGETHER_NIGHT", 0, beats);
  // by time of day, and by time of day in this room or outdoors (finer keys of the same minutes)
  w.tally("TOGETHER_WHEN", time, beats);
  w.tally("TOGETHER_WHEN", `${time}-${room}`, beats, { total: false });
  w.tally("TOGETHER_WHEN", `${time}-${where}`, beats, { total: false });
  const want = WANTS[p.last.want];
  if (want && want !== "idle") {
    w.tally("CHOOSE", want, 1);
    w.tally("CHOOSE", `${want}-${room}`, 1, { total: false });
  }
  // a day the pet was seen with every need at least a quarter full (DISTINCT counts the days)
  if (needsMinOf(p) >= 250) w.tally("HEALTHY_DAY", localDay(Date.now(), p.tzOffsetMin), 1, { total: false });
});

