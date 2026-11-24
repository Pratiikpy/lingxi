/**
 * Paid extras (plan 4.9): what a player's wallets bought on X Layer from the Extras contract, as last read from
 * the chain, and what it opens in the game. Room space lets more pieces stand in the home; saved looks keep whole
 * outfits to put on in one tap; a name colour shows a pet's name in one of eight colours. All of it is looks or
 * convenience, never play: the core game never needs any of it.
 */

import { MAX_PACKS, decorOf, roomCapacity } from "./decor";
import { type Outfit, PIECES, WEAR_SLOTS, type WearSlot, outfitOf, wear } from "./wardrobe";
import type { WorldResult, WorldState } from "./world";

/** Looks a player can save free, and how many more each look pack adds. */
export const LOOKS_BASE = 3;
export const LOOKS_PER_PACK = 3;
export const LOOKS_MAX = LOOKS_BASE + LOOKS_PER_PACK * MAX_PACKS;
export const LOOK_NAME_MAX = 16;

export interface Packs {
  room: number;
  looks: number;
}

export interface SavedLook {
  id: string;
  name: string;
  outfit: Outfit;
}

const packs = (n: unknown): number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 ? Math.min(MAX_PACKS, n) : 0;

/** The packs last read from X Layer; none until a reading arrives. */
export const extrasOf = (w: WorldState): Packs => ({ room: packs(w.extras?.room), looks: packs(w.extras?.looks) });
export const lookLimit = (w: WorldState): number => LOOKS_BASE + LOOKS_PER_PACK * extrasOf(w).looks;
export const savedLooks = (w: WorldState): SavedLook[] => w.looks ?? [];

/**
 * A new reading of the packs. Readings are clamped to what the contract allows, never trusted beyond it. When the
 * home holds less than is placed, the pieces placed last are put away: still owned or held, ready to place again.
 * Saved looks beyond a lower limit are kept but locked (see `wearLook`).
 */
export function syncExtras(w: WorldState, reading: Packs): WorldState {
  const next = { room: packs(reading.room), looks: packs(reading.looks) };
  const cur = extrasOf(w);
  if (w.extras && cur.room === next.room && cur.looks === next.looks) return w;
  const out: WorldState = { ...w, extras: next };
  const d = decorOf(out);
  const cap = roomCapacity(out);
  return d.placed.length > cap ? { ...out, decor: { ...d, placed: d.placed.slice(0, cap) } } : out;
}

/** A look's name: no markup or control characters, inner spaces kept, at most 16 characters. */
export const cleanLookName = (name: string): string =>
  Array.from(name.replace(/[\u0000-\u001f\u007f<>]/g, "").trim())
    .slice(0, LOOK_NAME_MAX)
    .join("")
    .trim();

/** The id of a piece a player drew or bought on a market; the game, not the engine, knows whether it may be worn. */
const PLAYER_PIECE = /^(u|c2?):[0-9a-z]{1,20}$/;

const sameOutfit = (a: Outfit, b: Outfit) => WEAR_SLOTS.every((s) => (a[s] ?? null) === (b[s] ?? null));

/** Keep an outfit as a look. Lingxi's pieces must sit in their own slot; player pieces are checked when worn. */
export function saveLook(w: WorldState, name: string, outfit: Outfit): WorldResult<{ id: string }> {
  const clean: Outfit = {};
  for (const s of WEAR_SLOTS) if (outfit[s]) clean[s] = outfit[s];
  if (!Object.keys(clean).length) return { ok: false, reason: "empty" };
  for (const s of WEAR_SLOTS) {
    const id = clean[s];
    if (id && !PLAYER_PIECE.test(id) && PIECES[id]?.slot !== s) return { ok: false, reason: "wrongSlot" };
  }
  const n = cleanLookName(name);
  if (!n) return { ok: false, reason: "name" };
  const looks = savedLooks(w);
  if (looks.length >= lookLimit(w)) return { ok: false, reason: "full" };
  if (looks.some((l) => sameOutfit(l.outfit, clean))) return { ok: false, reason: "same" };
  const made = (w.looksMade ?? 0) + 1;
  const id = `l${made}`;
  return { ok: true, id, world: { ...w, looks: [...looks, { id, name: n, outfit: clean }], looksMade: made } };
}

export function renameLook(w: WorldState, id: string, name: string): WorldResult {
  const looks = savedLooks(w);
  if (!looks.some((l) => l.id === id)) return { ok: false, reason: "unknown" };
  const n = cleanLookName(name);
  if (!n) return { ok: false, reason: "name" };
  return { ok: true, world: { ...w, looks: looks.map((l) => (l.id === id ? { ...l, name: n } : l)) } };
}

export function deleteLook(w: WorldState, id: string): WorldResult {
  const looks = savedLooks(w);
  if (!looks.some((l) => l.id === id)) return { ok: false, reason: "unknown" };
  return { ok: true, world: { ...w, looks: looks.filter((l) => l.id !== id) } };
}

/**
 * Put a saved look on one pet: exactly its outfit, slots it leaves empty taken off. A piece the player no longer
 * holds is skipped and named in `missing`. `mayWear` answers for player-made pieces (the game knows the designs and
 * which copies this player holds). A look beyond the current limit is locked, not lost.
 */
export function wearLook(
  w: WorldState,
  petKey: string,
  id: string,
  mayWear: (piece: string, slot: WearSlot) => boolean = () => false,
): WorldResult<{ missing: string[] }> {
  const looks = savedLooks(w);
  const at = looks.findIndex((l) => l.id === id);
  if (at < 0) return { ok: false, reason: "unknown" };
  if (at >= lookLimit(w)) return { ok: false, reason: "locked" };
  const look = looks[at]!;
  const missing: string[] = [];
  let out = w;
  for (const s of WEAR_SLOTS) {
    const piece = look.outfit[s];
    if (piece && PLAYER_PIECE.test(piece) && !mayWear(piece, s)) {
      missing.push(piece);
      if (outfitOf(out, petKey)[s]) out = takeOff(out, petKey, s);
      continue;
    }
    const r = wear(out, petKey, s, piece ?? null);
    if (r.ok) out = r.world;
    else {
      missing.push(piece!);
      if (outfitOf(out, petKey)[s]) out = takeOff(out, petKey, s);
    }
  }
  return { ok: true, world: out, missing };
}

const takeOff = (w: WorldState, petKey: string, slot: WearSlot): WorldState => {
  const r = wear(w, petKey, slot, null);
  return r.ok ? r.world : w;
};

export interface NameColour {
  /** the number the Extras contract stores for a pet (0 is plain) */
  id: number;
  name: { en: string; zh: string };
  /** the colour on the light theme's cream, and on the dark theme's night; both at least 4.5:1 */
  light: string;
  dark: string;
}

/** The eight name colours on offer, numbered as on chain. */
export const NAME_COLOURS: readonly NameColour[] = [
  { id: 1, name: { en: "Coral", zh: "珊瑚红" }, light: "#B83A24", dark: "#FF9A82" },
  { id: 2, name: { en: "Honey", zh: "蜂蜜金" }, light: "#7D5A00", dark: "#FFD45E" },
  { id: 3, name: { en: "Leaf", zh: "嫩叶绿" }, light: "#2A7040", dark: "#8FE0A5" },
  { id: 4, name: { en: "Sky", zh: "天空蓝" }, light: "#1F5FAA", dark: "#8CC4FF" },
  { id: 5, name: { en: "Violet", zh: "紫罗兰" }, light: "#6A3BBD", dark: "#C9A8FF" },
  { id: 6, name: { en: "Rose", zh: "玫瑰粉" }, light: "#A82C62", dark: "#FF9DC4" },
  { id: 7, name: { en: "Lagoon", zh: "湖水青" }, light: "#0C6A66", dark: "#6FE0D6" },
  { id: 8, name: { en: "Ember", zh: "余烬橙" }, light: "#9A4210", dark: "#FFB36B" },
];
export const NAME_COLOUR_BY_ID: Readonly<Record<number, NameColour>> = Object.fromEntries(
  NAME_COLOURS.map((c) => [c.id, c]),
);

/**
 * The message a wallet signs to be linked to a player's home (plan 4.9): the game signs it, the server checks it.
 * It names the home, so a signature serves no other home.
 */
export const homeLinkMessage = (owner: string): string =>
  `Lingxi home ${owner}\nLink this wallet to my Lingxi home, so visitors see what it holds on X Layer.\nThis is not a transaction and costs nothing.`;
