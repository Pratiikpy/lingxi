/**
 * The player's world on this device: where the pet is, the bag, coins and
 * quests. Saved in the browser beside the pet. Moving and searching tire the
 * pet; food from the bag goes through the game rules like any care.
 */
import { create } from "zustand";
import { awayTally, minuteTally } from "@lingxi/game";
import { type WorldState, bump, withFlag } from "@lingxi/world";
import { noteTallies, setQuestSlots, setTallySink } from "./tally";
import { PROOF_KEY, takeProofChecks } from "./proofMark";
import { type Chose, onCleaned, useGame } from "./store";
import { now } from "./gameClock";
import { load, save } from "./worldCore";
import { exploreActions } from "./worldExplore";
import { homeActions } from "./worldHome";
import { outingsActions } from "./worldOutings";
import { wardrobeActions } from "./worldWardrobe";

export interface WorldNotice {
  id: number;
  kind:
    | "moved"
    | "found"
    | "bought"
    | "made"
    | "claimed"
    | "fail"
    | "opened"
    | "planted"
    | "harvested"
    | "compost"
    | "sewn"
    | "built"
    | "readied";
  text?: string;
  items?: Array<{ item: number; n: number }>;
  reason?: string;
  coins?: number;
  /** a look around that filled the room's familiarity bar and showed its secret find */
  secret?: boolean;
  /** experience the pet earned at the bench */
  xp?: number;
}

export interface WorldStore {
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
  payGifts: (
    gifts: ReadonlyArray<
      { kind: "item"; item: number; n: number } | { kind: "coins"; n: number } | { kind: "decor"; id: string }
    >,
  ) => void;
  /** a spar's coins, paid while the day still has paid spars left (G6); returns what was paid */
  paySpar: (coins: number) => number;
  /** decorations for the home room */
  buyDecor: (id: string) => boolean;
  /** a Builder's commission for the home (G6), paid in coins and materials once the pet is old enough */
  commission: (id: string) => boolean;
  /** dig the garden's next plot (G6) */
  digPlot: () => boolean;
  /** puts a piece down in the home; true when it went down (a refusal says why in a notice) */
  placeDecor: (id: string, x: number, y: number) => boolean;
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
  lastOuting:
    | { kind: "walk"; steps: number; minutes: number; found: Array<{ item: number; n: number }>; capped: boolean }
    | { kind: "trip"; to: string; found: Array<{ item: number; n: number }>; learned: number | null }
    | null;
}

export const useWorld = create<WorldStore>((set, get) => ({
  world: load(),
  notice: null,
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
  lastOuting: null,
  ...exploreActions(set, get),
  ...homeActions(set, get),
  ...wardrobeActions(set, get),
  ...outingsActions(set, get),
}));

// cleaning up after a messy pet leaves compost for the garden (C4): the store announces the clean, the world takes it
onCleaned((cleanBefore) => useWorld.getState().compost(cleanBefore));

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
