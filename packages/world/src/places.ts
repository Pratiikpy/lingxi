/**
 * The world's places (P7: out of world.ts): every room with its look, drops, shop and secrets, the exits
 * between rooms, which rooms neighbour which, the affinities a room favours, and the energy a move and a look cost.
 */
/**
 * The world: rooms on a grid you walk between, things to find, a shop, a
 * workbench and quests. Pure functions over a small saved state; every random
 * find is decided by a hash of (seed, room, hour), so it cannot be rerolled by
 * reloading.
 */

import data from "./data/world.json";
import { familiarStep, tierWeight } from "./rules";
import { ROOM_TEXT, type RoomText } from "./rooms";
import { ITEM, SHOPS } from "./catalogue";

export const HOME = 65;

export const MOVE_ENERGY = 15;

export const FORAGE_ENERGY = 10;

export const FIRST_VISIT_COINS = 5;

export interface Room extends RoomText {
  index: number;
  x: number;
  y: number;
  z: number;
  bgs: { day: string; evening: string; night: string };
  /** rarity tier from the sheet (1 rare … 9 common) and the weight made from it */
  drops: Array<{ item: number; tier: number; weight: number }>;
  shop: number[];
  /** the kinds of pet at home here (the source's room affinity): Normal, Insect, Scrap, Eerie */
  affinity: Affinity[];
  /** looks around that fill this room's familiarity bar; 0 = no bar (plan 4.5, the source's scavenge cost / 50) */
  familiarSize: number;
}

export type Affinity = "Normal" | "Insect" | "Scrap" | "Eerie";

const AFFINITIES: readonly Affinity[] = ["Normal", "Insect", "Scrap", "Eerie"];

/** Which rooms a pet is at home in: its line's kind, and the eerie places if it is brave. */
export function affinitiesOf(line: "gentle" | "bold" | "curious", brave = false): Affinity[] {
  const own: Affinity = line === "gentle" ? "Normal" : line === "curious" ? "Insect" : "Scrap";
  return brave ? [own, "Eerie"] : [own];
}

/**
 * What some rooms keep for those who know them: the first time the bar fills there, this is the hidden find (after
 * that, a rare find of the room's own). The three parts of the Sky Sextant live here, so its recipe can be finished.
 */
export const ROOM_SECRETS: Readonly<Record<number, number>> = {
  88: 100001, // Treasure Hall: the Star Disk
  84: 100002, // Mine Tunnel: the Old Gear
  87: 100003, // Sunken Temple: the Temple Map
  53: 11413, // Blooming Tree: Mistletoe
};

/** Familiarity a look around adds: two where the pet is at home, one elsewhere. */
export const familiarGain = (room: Room, kin: readonly Affinity[]) =>
  familiarStep(room.affinity.some((a) => kin.includes(a)));

export const ROOMS: Record<number, Room> = Object.fromEntries(
  // the sheet's "weight" column holds the rarity tier, not the weight
  (
    data.rooms as Array<{
      index: number;
      x: number;
      y: number;
      z: number;
      bgs: Room["bgs"];
      drops: Array<{ item: number; weight: number }>;
      affinity?: string;
      scavCost?: number;
    }>
  )
    .filter((r) => ROOM_TEXT[r.index])
    .map((r) => [
      r.index,
      {
        ...ROOM_TEXT[r.index]!,
        index: r.index,
        x: r.x,
        y: r.y,
        z: r.z,
        bgs: r.bgs,
        drops: r.drops
          .filter((d) => ITEM[d.item])
          .map((d) => ({ item: d.item, tier: d.weight, weight: tierWeight(d.weight) })),
        shop: SHOPS[r.index] ?? [],
        affinity: (r.affinity ?? "")
          .split(",")
          .map((a) => a.trim())
          .filter((a): a is Affinity => (AFFINITIES as readonly string[]).includes(a)),
        familiarSize: Math.round((r.scavCost ?? 0) / 50),
      },
    ]),
);

const EXITS: Array<[number, number]> = (data.rooms as Array<{ index: number; exits: number[] }>).flatMap((r) =>
  r.exits.map((e) => [r.index, e] as [number, number]),
);

export function neighbours(index: number): number[] {
  const r = ROOMS[index];
  if (!r) return [];
  const out = new Set<number>();
  for (const o of Object.values(ROOMS)) {
    if (o.index !== index && o.z === r.z && Math.abs(o.x - r.x) + Math.abs(o.y - r.y) === 1) out.add(o.index);
  }
  for (const [a, b] of EXITS) {
    if (a === index && ROOMS[b]) out.add(b);
    if (b === index && ROOMS[a]) out.add(a);
  }
  return [...out].sort((a, b) => a - b);
}
