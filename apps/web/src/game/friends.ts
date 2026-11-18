/**
 * Pet friendships on this device (PRD M7). Each of your pets keeps its own
 * friendships; a friend is another player's pet, named by that player's id and
 * the pet's name, so friendships belong to pets rather than to players.
 */

import { create } from "zustand";
import { type BondEvent, type Bonds, BOND_NAMES, addBond } from "@lingxi/game";
import { useGame } from "./store";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";

const KEY = "lingxi.friends.v1";

export const friendKey = (playerId: string, petName: string) => `${playerId}:${petName}`;

type All = Record<string, Bonds>;

function load(): All {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as All) : {};
  } catch {
    return {};
  }
}

interface FriendsStore {
  all: All;
  /** the last level reached, for a toast */
  levelUp: { name: string; level: number; at: number } | null;
  /** record a moment with a friend for the active pet */
  meet: (playerId: string, who: { name: string; line: string }, event: BondEvent) => void;
}

export const useFriends = create<FriendsStore>((set, get) => ({
  all: load(),
  levelUp: null,
  meet: (playerId, who, event) => {
    const pet = useGame.getState().pet;
    if (!pet || !playerId || !who.name || pet.sitting) return;
    const mine = String(pet.bornAt);
    const id = friendKey(playerId, who.name);
    const r = addBond(get().all[mine] ?? {}, id, who, event, now());
    // nothing more today with a friend already known: no write
    if (!r.gained && get().all[mine]?.[id]) return;
    const all = { ...get().all, [mine]: r.bonds };
    try {
      saveWrite(KEY, JSON.stringify(all));
    } catch {
      // private mode: lasts for this visit
    }
    set({ all, ...(r.levelUp !== null ? { levelUp: { name: who.name, level: r.levelUp, at: now() } } : {}) });
  },
}));

/** The active pet's friendships. */
export const bondsOf = (all: All, petBornAt: number | undefined): Bonds => (petBornAt === undefined ? {} : (all[String(petBornAt)] ?? {}));

export const bondName = (level: number, lang: "en" | "zh") => BOND_NAMES[level]?.[lang] ?? "";
