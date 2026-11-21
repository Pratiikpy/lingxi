/**
 * What the things a player does count toward (quests, dailies, badges' tallies), in one place (G11). The web client
 * applies these entries to the player's tally and the 90-day simulator applies the same ones, so a change to what
 * counts can never pass the simulator unseen. Each rule is pure: it says what to count; the caller decides whether
 * the moment counts at all (the page is in view, the beats are consecutive).
 */

import { WANTS, timeOfDay } from "@lingxi/brain";
import { type ConditionView, HOME, INDOOR_ROOMS, TIMES_OF_DAY, type WorldState, localDay } from "@lingxi/world";
import { growthOf } from "./levels";
import { needsMinOf, stageOf } from "./pet";
import { type CareResult, type Pet, localHour } from "./sim";

/** One count added to the player's tally: `tally(type, index, n, { total })`. `total: false` is a finer key of a count. */
export type TallyEntry = [type: string, index: number | string, n: number, total: boolean];

/** What each care result counts as: CARE:<index>. */
export const CARE_INDEX: Readonly<Partial<Record<CareResult["note"], string>>> = { ate: "feed", woke: "feed", played: "play", cleaned: "clean", sleeping: "sleep", awake: "wake", petted: "pet", healed: "medicine", listened: "talk", used: "use" };

/**
 * A care, as what it actually did: CARE:<index>, and the same by the pet's time of day ("put it to bed at night").
 * Waking a pet that was not asleep did nothing, so it counts nothing.
 */
export function careTally(kind: string, wasAsleep: boolean, r: CareResult): TallyEntry[] {
  const i = CARE_INDEX[r.note];
  if (!i || (kind === "wake" && !wasAsleep)) return [];
  return [
    ["CARE", i, 1, true],
    ["CARE", `${i}-${TIMES_OF_DAY[timeOfDay(localHour(r.pet, r.pet.beat))]}`, 1, false],
  ];
}

/** A food the pet ate: which one, and its food group on the player's day ("three foods", "a balanced plate"). */
export function fedTally(item: number, diet: string | undefined, tzOffsetMin: number, now: number): TallyEntry[] {
  return [["FED", String(item), 1, true], ...(diet ? [["FED_GROUP", `${localDay(now, tzOffsetMin)}-${diet}`, 1, false] as TallyEntry] : [])];
}

/**
 * Watched minutes with the pet awake in a room: time together, by the time of day there and indoors or out, what its
 * brain chose that beat, and a day it was seen with every need at least a quarter full. A pet asleep, away, sitting
 * or hibernating counts nothing.
 */
export function minuteTally(room: number, p: Pet, now: number, beats = 1): TallyEntry[] {
  if (p.away || p.sitting || p.asleep || p.hibernating) return [];
  const time = TIMES_OF_DAY[timeOfDay(localHour(p, p.beat))]!;
  const where = INDOOR_ROOMS.has(room) || room === HOME ? "inside" : "outside";
  const out: TallyEntry[] = [
    ["TOGETHER", room, beats, true],
    ...(time === "night" ? [["TOGETHER_NIGHT", 0, beats, true] as TallyEntry] : []),
    ["TOGETHER_WHEN", time, beats, true],
    ["TOGETHER_WHEN", `${time}-${room}`, beats, false],
    ["TOGETHER_WHEN", `${time}-${where}`, beats, false],
  ];
  const want = WANTS[p.last.want];
  if (want && want !== "idle") out.push(["CHOOSE", want, 1, true], ["CHOOSE", `${want}-${room}`, 1, false]);
  if (needsMinOf(p) >= 250) out.push(["HEALTHY_DAY", localDay(now, p.tzOffsetMin), 1, false]);
  return out;
}

/** The pet's own choices while the player was away (G8): CHOOSE:<want>, in the room the game was left in. */
export function awayTally(room: number, wants: Readonly<Record<string, number>>): TallyEntry[] {
  return Object.entries(wants).flatMap(([want, n]): TallyEntry[] => [
    ["CHOOSE", want, n, true],
    ["CHOOSE", `${want}-${room}`, n, false],
  ]);
}

/** A conversation with a resident counts once. */
export const talkTally = (who: string): TallyEntry[] => [["TALK", who, 1, true]];

/** A look at a builder's pet on Builders' Lane, and the day it was made. */
export const meetTally = (id: string, now: number, tzOffsetMin: number): TallyEntry[] => [
  ["MEET", id, 1, true],
  ["MEET_DAY", `${id}-${localDay(now, tzOffsetMin)}`, 1, false],
];

/** Where each quest giver who is a resident can be found. */
export const GIVER_ROOM: Readonly<Record<string, number>> = { wick: 64, praline: 13, yonder: 3, bolt: 5, flit: 56, why: 59, jab: 89, twain: 19, nimbus: 53 };

/** Everything a quest condition reads, from the player's state: the active pet (or none yet), and what only the client knows. */
export function questView(i: { world: WorldState; pet: Pet | null; pets: number; onChain: boolean; bondLevel: number; goalsDone: readonly string[]; now: number; tzOffsetMin: number }): ConditionView {
  const { pet, now } = i;
  const stage = pet ? stageOf(pet, now) : null;
  return {
    world: i.world,
    pet: pet && stage ? { level: growthOf(pet).level, stage, onChain: i.onChain, needsMin: needsMinOf(pet) } : null,
    pets: i.pets,
    now,
    timeOfDay: pet ? (timeOfDay(localHour(pet, Math.floor(now / 60_000))) as 0 | 1 | 2 | 3) : 2,
    day: localDay(now, pet?.tzOffsetMin ?? i.tzOffsetMin),
    bondLevel: i.bondLevel,
    goalsDone: i.goalsDone,
  };
}
