/**
 * Trust with the residents and the Builders' Lane pets in the game (plan 4.3). The rules live in @lingxi/world
 * (friendship.ts); this module runs them on the saved world, on the pet's own calendar day, and says what
 * happened. In the game they are "neighbours", so as not to be confused with other players' pets (friends).
 */

import { create } from "zustand";
import {
  CHARACTERS,
  FRIEND_BY_ID,
  type FriendSheet,
  type Line,
  type Reward,
  type Taste,
  buyFromFriend,
  folkViewOf,
  giveGift,
  greetingNow,
  localDay,
  meetVisitor,
  openSteps,
  stepsTaken,
  takeStep,
  trustOf,
  type Unlock,
  type WorldState,
} from "@lingxi/world";
import { SUB, localHour } from "@lingxi/game";
import { questsOf } from "./quests";
import { play } from "./sound";
import { useGame } from "./store";
import { useWorld } from "./world";
import { now } from "./gameClock";

const today = () => localDay(now(), useGame.getState().pet?.tzOffsetMin ?? -new Date(now()).getTimezoneOffset());

/** A resident's greeting now, chosen by their circuit from the hour, trust, today's gift, the pet and their quests. */
export function greetingFor(id: string, fallback: readonly Line[]): Line[] {
  const pet = useGame.getState().pet;
  const view = folkViewOf(useWorld.getState().world, id, {
    hour: pet ? localHour(pet, Math.floor(now() / 60_000)) : new Date(now()).getHours(),
    day: today(),
    petHappy: !!pet && pet.meters.joy / SUB >= 600,
    petHungry: !!pet && pet.meters.food / SUB < 300,
    questReady: questsOf(id).ready.length > 0,
  });
  return greetingNow(id, view)?.lines ?? [...fallback];
}

/** Whom the player has met: the lane pets met on the lane, and the rooms they have been to (each resident's home). */
export interface Met {
  builders: readonly string[];
  rooms: readonly number[];
}

/**
 * R71: whether a step waits for the player with a neighbour: one is open, and it is someone they have met (begun a
 * friendship with, met on the lane, or been to the room of). Every friendship's first step is open from the start,
 * so a star on each open one stood by all fourteen on day 1, most of them in rooms not yet open to the player.
 */
export function stepWaiting(world: WorldState, sheet: FriendSheet, met: Met): boolean {
  if (!openSteps(world, sheet).length) return false;
  if (trustOf(world, sheet.id) > 0 || stepsTaken(world, sheet.id).length > 0) return true;
  if (sheet.kind === "lane") return met.builders.includes(sheet.id);
  const home = CHARACTERS.find((c) => c.id === sheet.id)?.room;
  return home !== undefined && met.rooms.includes(home);
}

/** The last thing that happened with a neighbour, for a short note under their words. */
export interface NeighbourNote {
  id: number;
  who: string;
  kind: "gift" | "step" | "buy" | "visit" | "fail";
  taste?: Taste;
  trust?: number;
  unlock?: Unlock;
  rewards?: readonly Reward[];
  reason?: string;
}

let n = 0;
export const useNeighbourNote = create<{
  note: NeighbourNote | null;
  set: (x: Omit<NeighbourNote, "id"> | null) => void;
}>((set) => ({
  note: null,
  set: (x) => set({ note: x ? { ...x, id: ++n } : null }),
}));
const say = (x: Omit<NeighbourNote, "id">) => useNeighbourNote.getState().set(x);

export function giftNeighbour(who: string, item: number): { taste: Taste; trust: number } | null {
  const f = FRIEND_BY_ID[who];
  if (!f) return null;
  const r = giveGift(useWorld.getState().world, f, item, today());
  if (!r.ok) {
    play("error");
    say({ who, kind: "fail", reason: r.reason });
    return null;
  }
  useWorld.getState().setWorld(r.world);
  play(r.taste === "love" ? "sparkle" : r.taste === "dislike" ? "tap" : "pop");
  say({ who, kind: "gift", taste: r.taste, trust: r.trust });
  return { taste: r.taste, trust: r.trust };
}

export function takeNeighbourStep(who: string, stepId: string): Unlock | null {
  const f = FRIEND_BY_ID[who];
  if (!f) return null;
  const r = takeStep(useWorld.getState().world, f, stepId);
  if (!r.ok) {
    play("error");
    say({ who, kind: "fail", reason: r.reason });
    return null;
  }
  useWorld.getState().setWorld(r.world);
  play("success");
  say({ who, kind: "step", unlock: r.unlock });
  return r.unlock;
}

export function buyFromNeighbour(who: string, item: number): boolean {
  const f = FRIEND_BY_ID[who];
  if (!f) return false;
  const r = buyFromFriend(useWorld.getState().world, f, item);
  if (!r.ok) {
    play("error");
    say({ who, kind: "fail", reason: r.reason });
    return false;
  }
  useWorld.getState().setWorld(r.world);
  play("success");
  say({ who, kind: "buy" });
  return true;
}

/** Meet the resident waiting at home: their keepsake and their words. */
export function meetNeighbourAtHome(who: string): ReturnType<typeof meetVisitor> | null {
  const f = FRIEND_BY_ID[who];
  if (!f) return null;
  const r = meetVisitor(useWorld.getState().world, f);
  if (!r.ok) return null;
  useWorld.getState().setWorld(r.world);
  play("sparkle");
  say({ who, kind: "visit", rewards: r.rewards });
  return r;
}
