/**
 * How the roster of pets is read from its save and written back (P1). A pet this build cannot read (saved by a newer
 * Lingxi, of a line it does not know, or beyond what the roster holds) is never dropped: it is kept exactly as saved,
 * written back with every save, and taken into the roster by a build that knows it.
 */

import { STARTERS } from "@lingxi/brain";
import { type Pet, withGrowth } from "@lingxi/game";

export const MAX_PETS = 8;

export interface Roster {
  active: number;
  pets: Pet[];
}

/** A pet this build can look after. */
export const knownPet = (p: unknown): p is Pet => !!p && typeof p === "object" && (p as Pet).version === 1 && !!STARTERS[(p as Pet).line];

/** A saved pet made current: lessons always a list, and a pet from before levels were spent keeps the level it showed (plan 4.4). */
const tidy = (p: Pet): Pet => withGrowth({ ...p, lessons: Array.isArray(p.lessons) ? p.lessons : [] });

/** The name a kept pet was saved with, for the pets screen. */
export const keptName = (p: unknown): string => {
  const n = p && typeof p === "object" ? (p as { name?: unknown }).name : undefined;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 24) : "?";
};

/**
 * Reads the roster's save (`raw`), or the single pet saved before families (`old`). Throws on text that is not JSON;
 * the save module holds such a save for the player's choice before the game reads it.
 */
export function readRoster(raw: string | null, old: string | null): { roster: Roster; kept: unknown[] } {
  if (raw) {
    const r = JSON.parse(raw) as { active?: unknown; pets?: unknown; kept?: unknown };
    const all: unknown[] = [...(Array.isArray(r.pets) ? r.pets : []), ...(Array.isArray(r.kept) ? r.kept : [])];
    const known = all.filter(knownPet).map(tidy);
    const pets = known.slice(0, MAX_PETS);
    const active = typeof r.active === "number" ? r.active | 0 : 0;
    return {
      roster: { active: Math.min(Math.max(0, active), Math.max(0, pets.length - 1)), pets },
      kept: [...all.filter((p) => !knownPet(p)), ...known.slice(MAX_PETS)],
    };
  }
  if (old) {
    const p = JSON.parse(old) as unknown;
    if (knownPet(p)) return { roster: { active: 0, pets: [tidy(p)] }, kept: [] };
    return { roster: { active: 0, pets: [] }, kept: p && typeof p === "object" ? [p] : [] };
  }
  return { roster: { active: 0, pets: [] }, kept: [] };
}

/** The roster's save: the kept pets ride along, untouched, whenever there are any. */
export const rosterText = (roster: Roster, kept: readonly unknown[]): string => JSON.stringify(kept.length ? { ...roster, kept } : roster);
