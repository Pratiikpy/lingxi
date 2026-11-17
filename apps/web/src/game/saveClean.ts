/**
 * Cleaning a saved world as it comes out of storage. Pure, so it can be tested on its own: an old save loads with
 * everything it had, and an edited save cannot give itself pieces, packs or bonuses it never earned. What lives on
 * X Layer (on-chain pieces, packs) is read again from the chain on start; the save only keeps the last reading.
 */

import { DECOR_BY_ID, LOOKS_MAX, MAX_PACKS, PLACE_AREA, WEAR_SLOTS, type WorldState, cleanLookName, isChainWear, roomCapacity } from "@lingxi/world";

/** Keep only well-formed decorations from storage: known pieces, owned, inside the room, within its capacity. */
export function cleanDecor(d: unknown, extras?: WorldState["extras"]): WorldState["decor"] {
  if (!d || typeof d !== "object") return undefined;
  const raw = d as { owned?: unknown; placed?: unknown; chainHeld?: unknown };
  // on-chain pieces are never owned by the game, only held on chain (read again from X Layer on start)
  const owned = Array.isArray(raw.owned) ? [...new Set(raw.owned.filter((x): x is string => typeof x === "string" && x in DECOR_BY_ID && !DECOR_BY_ID[x]!.chain))] : [];
  const chainHeld = Array.isArray(raw.chainHeld) ? [...new Set(raw.chainHeld.filter((x): x is string => typeof x === "string" && !!DECOR_BY_ID[x]?.chain))] : [];
  const placed = (Array.isArray(raw.placed) ? raw.placed : [])
    .filter((p): p is { id: string; x: number; y: number } => !!p && typeof p.id === "string" && (owned.includes(p.id) || chainHeld.includes(p.id)) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
    .slice(0, roomCapacity({ extras } as WorldState))
    .map((p) => ({ id: p.id, x: Math.max(PLACE_AREA.x0, Math.min(PLACE_AREA.x1, Math.round(p.x))), y: Math.max(PLACE_AREA.y0, Math.min(PLACE_AREA.y1, Math.round(p.y))) }));
  return chainHeld.length ? { owned, placed, chainHeld } : { owned, placed };
}

/** Only whole, non-negative counts under well-formed keys survive a reload. */
export function cleanTally(t: unknown): Record<string, number> {
  if (!t || typeof t !== "object") return {};
  return Object.fromEntries(Object.entries(t as Record<string, unknown>).filter((e): e is [string, number] => /^[A-Z_]{2,24}:[\w:-]{1,40}$/.test(e[0]) && Number.isSafeInteger(e[1]) && (e[1] as number) >= 0));
}

/** Bonuses and familiarity from storage: small whole numbers only, so an edited save cannot mint a huge bonus. */
export function cleanCounts<K extends string>(o: unknown, keyOk: (k: string) => boolean, max: number): Partial<Record<K, number>> | undefined {
  if (!o || typeof o !== "object") return undefined;
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter((e): e is [K, number] => keyOk(e[0]) && Number.isSafeInteger(e[1]) && (e[1] as number) >= 0 && (e[1] as number) <= max)) as Partial<Record<K, number>>;
}
const BUFF_KEYS = ["forageExtra", "sparPower", "sparHp", "sparLossCoins"];

export const cleanFlags = (f: unknown): string[] => (Array.isArray(f) ? [...new Set(f.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x)))] : []);

/** Packs from storage: whole numbers 0..3 only; they are read again from X Layer on start. */
export function cleanExtras(e: unknown): WorldState["extras"] {
  if (!e || typeof e !== "object") return undefined;
  const r = e as Record<string, unknown>;
  const p = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 ? Math.min(MAX_PACKS, n) : 0);
  return { room: p(r.room), looks: p(r.looks) };
}

/** Saved looks from storage: well-formed ids, clean names, slots holding piece ids; at most the most a player can have. */
export function cleanLooks(l: unknown): WorldState["looks"] {
  if (!Array.isArray(l)) return undefined;
  const out: NonNullable<WorldState["looks"]> = [];
  for (const x of l) {
    if (!x || typeof x !== "object") continue;
    const { id, name, outfit } = x as Record<string, unknown>;
    if (typeof id !== "string" || !/^l\d{1,6}$/.test(id) || out.some((o) => o.id === id) || typeof name !== "string" || !cleanLookName(name)) continue;
    if (!outfit || typeof outfit !== "object") continue;
    const fit: Record<string, string> = {};
    for (const s of WEAR_SLOTS) {
      const v = (outfit as Record<string, unknown>)[s];
      if (typeof v === "string" && /^[\w:-]{1,40}$/.test(v)) fit[s] = v;
    }
    if (Object.keys(fit).length) out.push({ id, name: cleanLookName(name), outfit: fit });
    if (out.length >= LOOKS_MAX) break;
  }
  return out;
}

/** The wardrobe from storage, with its on-chain pieces kept only as limited pieces (read again from X Layer on start). */
export function cleanWardrobe(wd: unknown): WorldState["wardrobe"] {
  if (!wd || typeof wd !== "object") return undefined;
  const raw = wd as { owned?: unknown; worn?: unknown; chainHeld?: unknown };
  const chainHeld = Array.isArray(raw.chainHeld) ? [...new Set(raw.chainHeld.filter((x): x is string => typeof x === "string" && isChainWear(x)))] : [];
  const owned = Array.isArray(raw.owned) ? raw.owned.filter((x): x is string => typeof x === "string" && !isChainWear(x)) : [];
  const worn = raw.worn && typeof raw.worn === "object" ? (raw.worn as NonNullable<WorldState["wardrobe"]>["worn"]) : {};
  return chainHeld.length ? { owned, worn, chainHeld } : { owned, worn };
}

/** A saved world (version 1) cleaned for use. Fields the save never had stay absent. */
export function cleanWorld(w: WorldState): WorldState {
  const extras = cleanExtras(w.extras);
  const looks = cleanLooks(w.looks);
  const looksMade = Number.isSafeInteger(w.looksMade) && (w.looksMade as number) >= 0 ? (w.looksMade as number) : undefined;
  const clean: WorldState = {
    ...w,
    claimed: Array.isArray(w.claimed) ? w.claimed : [],
    decor: cleanDecor(w.decor, extras),
    tally: cleanTally(w.tally),
    flags: cleanFlags(w.flags),
    buffs: cleanCounts(w.buffs, (k) => BUFF_KEYS.includes(k), 500),
    familiar: cleanCounts(w.familiar, (k) => /^\d{1,4}$/.test(k), 100) as WorldState["familiar"],
    wardrobe: cleanWardrobe(w.wardrobe),
    ...(extras ? { extras } : {}),
    ...(looks ? { looks } : {}),
    // a new look's id must never repeat one kept in the save
    ...(looks || looksMade !== undefined ? { looksMade: Math.max(looksMade ?? 0, ...(looks ?? []).map((l) => Number(l.id.slice(1)))) } : {}),
  };
  for (const k of ["decor", "wardrobe", "buffs", "familiar"] as const) if (clean[k] === undefined) delete clean[k];
  if (!extras) delete clean.extras;
  if (!looks) delete clean.looks;
  return clean;
}
