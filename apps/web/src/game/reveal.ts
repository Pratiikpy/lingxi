/**
 * Reveal the game gradually (PRD U6): day 1 is hatch, name, feed and play;
 * teaching and the world open on day 2, spars on day 3; families need a grown
 * pet anyway. Locked tabs stay in sight and say when they open, and anyone can
 * open everything at once (impatient players, and anyone trying Lingxi in one
 * sitting), so nothing is ever hidden that a player wants.
 */

import { create } from "zustand";
import { type Pet, dayOf } from "@lingxi/game";

const KEY = "lingxi.reveal.v1";
export type Gated = "mind" | "map" | "bag" | "spar";

/** The pet's day each part opens on. */
export const OPENS_ON: Record<Gated, number> = { mind: 2, map: 2, bag: 2, spar: 3 };

function readAll(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

interface RevealState {
  all: boolean;
  openAll: () => void;
}

export const useReveal = create<RevealState>((set) => ({
  all: readAll(),
  openAll: () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // still open for this visit
    }
    set({ all: true });
  },
}));

/** Whether a part is open for this pet now. */
export function isOpen(part: string, pet: Pet, all: boolean, now = Date.now()): boolean {
  if (all || !(part in OPENS_ON)) return true;
  return dayOf(pet, now) >= OPENS_ON[part as Gated];
}
