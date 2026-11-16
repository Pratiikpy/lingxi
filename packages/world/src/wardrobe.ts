/**
 * The wardrobe (PRD S4, W6, M3): outfits are cosmetic only, never stats. Pieces
 * are sewn at the workbench from things found on walks and in the garden, a few
 * are sold at the Corner Shop, and the champion's laurel comes only from
 * winning a weekly season. Each pet wears its own outfit; a full set of one
 * theme earns a title. The workbench also builds furniture for the home.
 */

import { DECOR_BY_ID } from "./decor";
import type { WorldResult, WorldState } from "./world";

export const WEAR_SLOTS = ["head", "face", "held"] as const;
export type WearSlot = (typeof WEAR_SLOTS)[number];

/** what each piece is, by the ids @lingxi/art draws */
export const PIECES: Readonly<Record<string, { slot: WearSlot; set: string }>> = {
  sunhat: { slot: "head", set: "picnic" },
  beanie: { slot: "head", set: "winter" },
  crown: { slot: "head", set: "royal" },
  bow: { slot: "head", set: "picnic" },
  laurel: { slot: "head", set: "champion" },
  glasses: { slot: "face", set: "scholar" },
  shades: { slot: "face", set: "royal" },
  hearts: { slot: "face", set: "picnic" },
  balloon: { slot: "held", set: "picnic" },
  flag: { slot: "held", set: "winter" },
  lantern: { slot: "held", set: "royal" },
  sunflower: { slot: "held", set: "scholar" },
};

export interface MakeRecipe {
  id: string;
  kind: "outfit" | "furniture";
  ins: Array<{ item: number; amount: number }>;
}

/** Sewing and building at the workbench. Furniture ids are decor ids. */
export const MAKE_RECIPES: readonly MakeRecipe[] = [
  { id: "sunhat", kind: "outfit", ins: [{ item: 1016, amount: 2 }, { item: 1001, amount: 1 }] },
  { id: "beanie", kind: "outfit", ins: [{ item: 1012, amount: 2 }, { item: 1002, amount: 1 }] },
  { id: "bow", kind: "outfit", ins: [{ item: 1011, amount: 2 }, { item: 1003, amount: 1 }] },
  { id: "crown", kind: "outfit", ins: [{ item: 1007, amount: 1 }, { item: 1005, amount: 2 }] },
  { id: "glasses", kind: "outfit", ins: [{ item: 1006, amount: 1 }, { item: 1005, amount: 1 }] },
  { id: "shades", kind: "outfit", ins: [{ item: 1006, amount: 1 }, { item: 1010, amount: 1 }] },
  { id: "hearts", kind: "outfit", ins: [{ item: 1014, amount: 2 }] },
  { id: "balloon", kind: "outfit", ins: [{ item: 1003, amount: 1 }, { item: 1001, amount: 1 }] },
  { id: "flag", kind: "outfit", ins: [{ item: 1001, amount: 2 }, { item: 1012, amount: 1 }] },
  { id: "lantern", kind: "outfit", ins: [{ item: 1004, amount: 1 }, { item: 1013, amount: 1 }] },
  { id: "sunflower", kind: "outfit", ins: [{ item: 1011, amount: 1 }, { item: 1004, amount: 1 }] },
  { id: "books", kind: "furniture", ins: [{ item: 1016, amount: 3 }, { item: 1001, amount: 2 }] },
  { id: "mushroom", kind: "furniture", ins: [{ item: 1013, amount: 2 }, { item: 1002, amount: 2 }] },
  { id: "lantern", kind: "furniture", ins: [{ item: 1003, amount: 1 }, { item: 1001, amount: 3 }] },
];

/** pieces the Corner Shop sells, for coins */
export const PIECE_PRICES: Readonly<Record<string, number>> = { bow: 40, balloon: 25, hearts: 20 };

export type Outfit = Partial<Record<WearSlot, string>>;

export const ownedPieces = (w: WorldState): string[] => w.wardrobe?.owned ?? [];
export const outfitOf = (w: WorldState, petKey: string): Outfit => w.wardrobe?.worn[petKey] ?? {};

const wardrobe = (w: WorldState) => w.wardrobe ?? { owned: [], worn: {} };
const bagAdd = (bag: Record<number, number>, item: number, n: number) => {
  const next = { ...bag, [item]: (bag[item] ?? 0) + n };
  if (next[item]! <= 0) delete next[item];
  return next;
};

/** Sew a piece or build a piece of furniture from materials in the bag. */
export function make(w: WorldState, kind: MakeRecipe["kind"], id: string): WorldResult {
  const r = MAKE_RECIPES.find((x) => x.kind === kind && x.id === id);
  if (!r) return { ok: false, reason: "noRecipe" };
  if (!r.ins.every((x) => (w.bag[x.item] ?? 0) >= x.amount)) return { ok: false, reason: "missing" };
  let bag = w.bag;
  for (const x of r.ins) bag = bagAdd(bag, x.item, -x.amount);
  if (kind === "outfit") {
    const wd = wardrobe(w);
    if (wd.owned.includes(id)) return { ok: false, reason: "owned" };
    return { ok: true, world: { ...w, bag, wardrobe: { ...wd, owned: [...wd.owned, id] }, crafted: w.crafted + 1 } };
  }
  if (!DECOR_BY_ID[id]) return { ok: false, reason: "noRecipe" };
  const d = w.decor ?? { owned: [], placed: [] };
  if (d.owned.includes(id)) return { ok: false, reason: "owned" };
  return { ok: true, world: { ...w, bag, decor: { ...d, owned: [...d.owned, id] }, crafted: w.crafted + 1 } };
}

export const CORNER_SHOP = 4;

export function buyPiece(w: WorldState, id: string): WorldResult {
  const price = PIECE_PRICES[id];
  if (price === undefined || w.room !== CORNER_SHOP) return { ok: false, reason: "notSold" };
  const wd = wardrobe(w);
  if (wd.owned.includes(id)) return { ok: false, reason: "owned" };
  if (w.coins < price) return { ok: false, reason: "coins" };
  return { ok: true, world: { ...w, coins: w.coins - price, wardrobe: { ...wd, owned: [...wd.owned, id] } } };
}

/** Puts a piece on (or, with null, takes the slot's piece off) for one pet. */
/** The id of a piece a player drew or bought on a market, as opposed to one of Lingxi's own pieces. */
const PLAYER_PIECE = /^(u|c2?):[0-9a-z]{1,20}$/;

export function wear(w: WorldState, petKey: string, slot: WearSlot, id: string | null): WorldResult {
  const wd = wardrobe(w);
  // a player-made piece ("u:" drawn on this device, "c:" a copy from the OKB market, "c2:" from the BEM market) is
  // checked by the game, which knows the designs and which copies this player holds
  if (id !== null && !PLAYER_PIECE.test(id)) {
    const p = PIECES[id];
    if (!p || p.slot !== slot) return { ok: false, reason: "wrongSlot" };
    if (!wd.owned.includes(id)) return { ok: false, reason: "notOwned" };
  }
  const current = { ...(wd.worn[petKey] ?? {}) };
  if (id === null) delete current[slot];
  else current[slot] = id;
  return { ok: true, world: { ...w, wardrobe: { ...wd, worn: { ...wd.worn, [petKey]: current } } } };
}

/** The champion's laurel, given once to a season's winner on this device. */
export function giveLaurel(w: WorldState): WorldState {
  const wd = wardrobe(w);
  return wd.owned.includes("laurel") ? w : { ...w, wardrobe: { ...wd, owned: [...wd.owned, "laurel"] } };
}

/** The set a full outfit completes: a piece in every slot, all of one theme. */
export function setOf(outfit: Outfit): string | null {
  const sets = WEAR_SLOTS.map((s) => (outfit[s] ? PIECES[outfit[s]!]?.set : undefined));
  if (sets.some((x) => !x)) return null;
  return sets.every((x) => x === sets[0]) ? sets[0]! : null;
}
