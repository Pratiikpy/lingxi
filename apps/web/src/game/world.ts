/**
 * The player's world on this device: where the pet is, the bag, coins and
 * quests. Saved in the browser beside the pet. Moving and searching tire the
 * pet; food from the bag goes through the game rules like any care.
 */

import { deleteLook as deleteLookRule, renameLook as renameLookRule, saveLook as saveLookRule, wearLook as wearLookRule, buyDecor as buyDecorRule, payReward as payRewardRule, buyMarket as buyMarketRule, luckyFind as luckyFindRule, takeVillageGift as takeVillageGiftRule, commissionDecor as commissionDecorRule, digPlot as digPlotRule, placeDecor as placeDecorRule, removeDecor as removeDecorRule, COMPOST, compostFromClean, harvest as harvestRule, plant as plantRule, startWalk as startWalkRule, stepWalk as stepWalkRule, endWalk as endWalkRule, startTrip as startTripRule, endTrip as endTripRule, make as makeRule, buyPiece as buyPieceRule, wear as wearRule, giveLaurel as giveLaurelRule } from "@lingxi/world";
import { useBadges } from "./badges";
import { create } from "zustand";
import { wearableOf } from "@lingxi/art";
import { useDesigns } from "./designs";
import { exert, work, stageOf, exploreMods, awayTally, fedTally, minuteTally } from "@lingxi/game";
import {
  ITEM,
  type WorldState,
  buy as buyItem,
  claim as claimQuest,
  craft as craftRecipe,
  earn,
  paySpar as paySparWin,
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
  outfitOf,
} from "@lingxi/world";
import { noteTallies, setQuestSlots, setTallySink } from "./tally";
import { cleanWorld } from "./saveClean";
import { PROOF_KEY, takeProofChecks } from "./proofMark";
import { useChain } from "./chain";
import { type Chose, brainOf, useGame } from "./store";
import { play } from "./sound";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";

const KEY = "lingxi.world.v1";

function load(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as WorldState;
      if (w.version === 1) {
        const clean = cleanWorld(w);
        // a save from before tools (plan 4.5) that already took the pebbles gets the screwdriver that quest now gives, once
        const screwdriver = clean.claimed.includes("q07") && !(clean.flags ?? []).includes("tools-given") && !(clean.bag[23102] ?? 0) ? withFlag(giveItem(clean, 23102, 1), "tools-given") : clean;
        // and one that already finished Praline's apprentice quest gets the burner it now gives (2026-11-18), once
        const tooled = screwdriver.claimed.includes("q22") && !(screwdriver.flags ?? []).includes("burner-given") && !(screwdriver.bag[23101] ?? 0) ? withFlag(giveItem(screwdriver, 23101, 1), "burner-given") : screwdriver;
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
    saveWrite(KEY, JSON.stringify(w));
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
  /** D2: today's market item at the Corner Shop */
  buyMarket: () => void;
  /** D2: today's resident gift, when talking to that resident; the item given, or null */
  villageGift: (who: string) => number | null;
  craft: (recipe: number) => void;
  use: (item: number) => void;
  openBox: (box?: number) => void;
  /** the bonuses waiting for the next spar, spent as it starts (plan 4.5) */
  spendSparBuffs: () => { power: number; hp: number; lossCoins: number };
  claim: (id: string) => void;
  /** coins won outside the world (spars) */
  reward: (coins: number) => void;
  /** keepsakes visitors left (G4): items, coins or a home piece, paid into the world */
  payGifts: (gifts: ReadonlyArray<{ kind: "item"; item: number; n: number } | { kind: "coins"; n: number } | { kind: "decor"; id: string }>) => void;
  /** a spar's coins, paid while the day still has paid spars left (G6); returns what was paid */
  paySpar: (coins: number) => number;
  /** decorations for the home room */
  buyDecor: (id: string) => boolean;
  /** a Builder's commission for the home (G6), paid in coins and materials once the pet is old enough */
  commission: (id: string) => boolean;
  /** dig the garden's next plot (G6) */
  digPlot: () => boolean;
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
  /** saved looks (plan 4.9): keep the outfit a pet wears, put one on, rename or delete it; false or a reason when refused */
  saveLook: (name: string, petKey: string) => { ok: true } | { ok: false; reason: string };
  wearLook: (petKey: string, id: string) => { ok: true; missing: string[] } | { ok: false; reason: string };
  renameLook: (id: string, name: string) => boolean;
  deleteLook: (id: string) => boolean;
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
  g.replace(exert(p, energy, now(), brainOf(p)));
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
    const r = moveTo(get().world, to, petEnergy(), mods, now());
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
    set({ world: moved, notice: { id: ++n, kind: "moved", coins: r.coins, ...(r.found ? { items: [r.found] } : {}) } });
    return true;
  },
  forage: () => {
    const mods = petMods();
    const p = useGame.getState().pet;
    // at home where its kind lives: twice the familiarity (brave pets are at home in eerie places too)
    const kin = p ? affinitiesOf(p.line, ((p.instincts ?? 0) & 1) === 1) : [];
    const r = forageHere(get().world, now(), petEnergy(), mods, kin);
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    tirePet(mods.forageEnergy);
    // D2: on the village's lucky day, the first look around in its room finds one more thing
    const lucky = luckyFindRule(r.world, now(), mods);
    const after = lucky.ok ? lucky.world : r.world;
    const found = lucky.ok ? [...r.found.filter((f) => f.item !== lucky.item), { item: lucky.item, n: (r.found.find((f) => f.item === lucky.item)?.n ?? 0) + 1 }] : r.found;
    save(after);
    play("success");
    set({ world: after, notice: { id: ++n, kind: "found", items: found, ...(r.familiar?.filled ? { secret: true } : {}), ...(lucky.ok ? { text: "lucky" } : {}) } });
  },
  buyMarket: () => {
    const r = buyMarketRule(get().world, now());
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("pop");
    set({ world: r.world, notice: { id: ++n, kind: "bought", items: [{ item: r.item, n: 1 }] } });
  },
  villageGift: (who) => {
    const r = takeVillageGiftRule(get().world, who, now());
    if (!r.ok) return null;
    save(r.world);
    play("sparkle");
    set({ world: r.world });
    return r.item;
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
    if (p) g.replace(work(p, r.energy, r.xp, now(), brainOf(p)));
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
      noteTallies(fedTally(item, r.use.diet, after.pet.tzOffsetMin, now()));
    }
  },
  openBox: (box = 21007) => {
    const r = openBoxRule(get().world, now(), box);
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
    const r = plantRule(get().world, plot, crop, withCompost, now());
    if (!r.ok) {
      play("error");
      return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    }
    save(r.world);
    play("pop");
    set({ world: r.world, notice: { id: ++n, kind: "planted" } });
  },
  harvest: (plot) => {
    const r = harvestRule(get().world, plot, now());
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
  saveLook: (name, petKey) => {
    const r = saveLookRule(get().world, name, outfitOf(get().world, petKey));
    if (!r.ok) {
      play("error");
      return { ok: false, reason: r.reason };
    }
    save(r.world);
    play("success");
    set({ world: r.world });
    return { ok: true };
  },
  wearLook: (petKey, id) => {
    // a player-made piece goes on only when this player may wear it, in the slot it was drawn for
    const mayWear = (piece: string, slot: string) => useDesigns.getState().canWear(piece) && wearableOf(piece)?.slot === slot;
    const r = wearLookRule(get().world, petKey, id, mayWear);
    if (!r.ok) {
      play("error");
      return { ok: false, reason: r.reason };
    }
    save(r.world);
    play("pop");
    set({ world: r.world });
    return { ok: true, missing: r.missing };
  },
  renameLook: (id, name) => {
    const r = renameLookRule(get().world, id, name);
    if (!r.ok) return false;
    save(r.world);
    set({ world: r.world });
    return true;
  },
  deleteLook: (id) => {
    const r = deleteLookRule(get().world, id);
    if (!r.ok) return false;
    save(r.world);
    play("tap");
    set({ world: r.world });
    return true;
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
    const r = startWalkRule(get().world, now(), sensor);
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    set({ world: r.world, lastOuting: null });
  },
  addSteps: (steps) => {
    const r = stepWalkRule(get().world, steps, now(), petMods());
    if (!r.ok) return;
    save(r.world);
    if (r.found.length) play("pop");
    set({ world: r.world });
  },
  endWalk: () => {
    const r = endWalkRule(get().world, now(), petMods());
    if (!r.ok) return;
    save(r.world);
    set({ world: r.world, lastOuting: { kind: "walk", steps: r.steps, minutes: r.minutes, found: r.finds, capped: r.capped } });
    // a walk together is play: joy for the pet, and it tires
    if (r.minutes >= 5) useGame.getState().act({ kind: "play" });
  },
  startTrip: (to) => {
    const r = startTripRule(get().world, to, now());
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    set({ world: r.world, lastOuting: null });
  },
  endTrip: () => {
    const r = endTripRule(get().world, now(), petMods());
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
  commission: (id) => {
    const p = useGame.getState().pet;
    const r = commissionDecorRule(get().world, id, p ? stageOf(p, now()) : "baby");
    if (!r.ok) {
      play("error");
      set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
      return false;
    }
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "built", text: id } });
    return true;
  },
  digPlot: () => {
    const p = useGame.getState().pet;
    const r = digPlotRule(get().world, p ? stageOf(p, now()) : "baby");
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
  payGifts: (gifts) => {
    if (!gifts.length) return;
    let w = get().world;
    for (const g of gifts) w = payRewardRule(w, g);
    save(w);
    set({ world: w });
  },
  paySpar: (coins) => {
    const r = paySparWin(get().world, now(), coins);
    if (r.paid > 0) {
      save(r.world);
      set({ world: r.world });
    }
    return r.paid;
  },
  claim: (id) => {
    const p = useGame.getState().pet;
    if (!p) return;
    const r = claimQuest(get().world, id, { counts: p.counts, stage: stageOf(p, now()), onChain: useChain.getState().record !== null });
    if (!r.ok) return set({ notice: { id: ++n, kind: "fail", reason: r.reason } });
    save(r.world);
    play("success");
    set({ world: r.world, notice: { id: ++n, kind: "claimed", coins: r.coins, items: r.items } });
  },
}));

// the pet's events (care, lessons, spars, saves) are counted into the tally the world store owns
setTallySink((type, index, count, opts) => useWorld.getState().tally(type, index, count, opts));
setQuestSlots(() => ((useWorld.getState().world.flags ?? []).includes("lesson-slot") ? 1 : 0));

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
/**
 * The pet's own choices while the player was away (G8): each want its brain chose, awake, counts as CHOOSE:<want>, in
 * the room the game was left in, as a choice made while watched does.
 */
let choseSeen = 0;
const countAway = (c: Chose | null) => {
  if (!c || c.id === choseSeen) return;
  choseSeen = c.id;
  noteTallies(awayTally(useWorld.getState().world.room, c.wants));
};
countAway(useGame.getState().chose);
useGame.subscribe((s) => countAway(s.chose));

useGame.subscribe((s, prev) => {
  const p = s.pet;
  const q = prev.pet;
  if (!p || !q || p.bornAt !== q.bornAt || p.beat <= q.beat || p.beat - q.beat > 2) return;
  if (p.away || p.sitting || p.asleep || p.hibernating) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  // what the minutes count toward is the shared rule (G11); whether they count at all (in view, consecutive) is ours
  noteTallies(minuteTally(useWorld.getState().world.room, p, now(), p.beat - q.beat));
});

