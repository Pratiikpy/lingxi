/**
 * Reveal the game gradually (PRD U6): day 1 is hatch, name, feed, play and
 * teaching (H5: teaching is the game's heart, and what someone trying it meets
 * first); the world opens on day 2, spars on day 3; families need a grown pet
 * anyway. A quest that points at a part opens it from the moment it is taken,
 * so no quest ever sends the player to a lock. Locked tabs stay in sight and say when they open, and anyone can
 * open everything at once (impatient players, and anyone trying Lingxi in one
 * sitting), so nothing is ever hidden that a player wants.
 */

import { create } from "zustand";
import { type Pet, dayOf } from "@lingxi/game";
import { ONBOARDING, QUEST_BY_ID, type QuestStatus } from "@lingxi/world";
import { now as gameNow } from "./gameClock";

const KEY = "lingxi.reveal.v1";
export type Gated = "map" | "bag" | "spar";

/** The pet's day each part opens on. */
export const OPENS_ON: Record<Gated, number> = { map: 2, bag: 2, spar: 3 };

/** The part each first-arc quest's hint rings, when it is one that opens by day. */
const HINT_OPENS: Partial<Record<string, Gated>> = { map: "map", bag: "bag" };

/** The parts opened early because a quest taken (or finished) points at them (H5). */
export function openedByQuests(statuses: Readonly<Record<string, QuestStatus>>): Gated[] {
  const out = new Set<Gated>();
  for (const id of ONBOARDING) {
    const st = statuses[id];
    if (st !== "active" && st !== "ready" && st !== "done") continue;
    const part = HINT_OPENS[QUEST_BY_ID[id]?.hint ?? ""];
    if (part) out.add(part);
  }
  return [...out];
}

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
export function isOpen(part: string, pet: Pet, all: boolean, now = gameNow(), opened: readonly Gated[] = []): boolean {
  if (all || !(part in OPENS_ON) || opened.includes(part as Gated)) return true;
  return dayOf(pet, now) >= OPENS_ON[part as Gated];
}
