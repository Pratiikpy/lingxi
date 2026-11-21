/**
 * What the simulator needs from the web client, which the shared packages do not hold.
 *
 * What a spar win pays and how long a round is shown come from the game package, which the arena imports too. The
 * client's tally glue (what a care, a watched minute or a food counts toward quests) has no shared function to call,
 * so it is written out here once, line for line with the client, each part naming the client line it follows.
 * Everything else the simulator does calls the shared rules directly.
 */

import { WANTS, timeOfDay } from "@lingxi/brain";
import { HOME, INDOOR_ROOMS, TIMES_OF_DAY, type ConditionView, type WorldState, localDay } from "@lingxi/world";
import { type CareResult, type Pet, friendPartner, growthOf, localHour, needsMinOf, petCard, stageOf } from "../../src";

/** What a spar won pays and how long a round is shown: the game's own numbers, shared with the arena (spar.ts). */
export { SPAR_WIN_COINS as WIN_COINS, SPAR_FIRST_WIN_COINS as FIRST_WIN_COINS, SPAR_ROUND_MS as ROUND_MS, SPAR_FIRST_ROUND_MS as FIRST_ROUND_MS } from "../../src";

/**
 * A pet's level in a spar by its stage. The client's Arena.tsx `levelOf` has a shared twin: the level a friend's
 * card fights at (partners.ts friendPartner), which this asks.
 */
const levels = new Map<string, number>();
export function sparLevel(stage: string): number {
  let level = levels.get(stage);
  if (level === undefined) {
    const p = friendPartner({ id: "sim", name: "sim", line: "gentle", stage, lessons: petCard({ lessons: [] }) });
    if (!p) throw new Error("friendPartner refused an empty card");
    levels.set(stage, (level = p.level));
  }
  return level;
}

/** apps/web/src/game/store.ts CARE_INDEX: what each care result counts as. */
const CARE_INDEX: Partial<Record<CareResult["note"], string>> = { ate: "feed", woke: "feed", played: "play", cleaned: "clean", sleeping: "sleep", awake: "wake", petted: "pet", healed: "medicine", listened: "talk", used: "use" };

/** One count the client adds to the player's tally: `bump(world, type, index, n, { total })`. */
export type TallyEntry = [type: string, index: number | string, n: number, total: boolean];

/** store.ts countCare: what a care counts (waking a pet that was not asleep did nothing). */
export function careTally(kind: string, wasAsleep: boolean, r: CareResult): TallyEntry[] {
  const i = CARE_INDEX[r.note];
  if (!i || (kind === "wake" && !wasAsleep)) return [];
  const time = TIMES_OF_DAY[timeOfDay(localHour(r.pet, r.pet.beat))];
  return [["CARE", i, 1, true], ["CARE", `${i}-${time}`, 1, false]];
}

/** world.ts `use`: a food the pet ate, by item and by its food group today. */
export function fedTally(item: number, diet: string | undefined, p: Pet, now: number): TallyEntry[] {
  return [["FED", String(item), 1, true], ...(diet ? [["FED_GROUP", `${localDay(now, p.tzOffsetMin)}-${diet}`, 1, false] as TallyEntry] : [])];
}

/** world.ts's subscription to the game store: one watched minute, awake, counted as time together and as its choice. */
export function minuteTally(room: number, p: Pet, now: number): TallyEntry[] {
  if (p.asleep || p.hibernating || p.away) return [];
  const time = TIMES_OF_DAY[timeOfDay(localHour(p, p.beat))]!;
  const where = INDOOR_ROOMS.has(room) || room === HOME ? "inside" : "outside";
  const out: TallyEntry[] = [
    ["TOGETHER", room, 1, true],
    ...(time === "night" ? [["TOGETHER_NIGHT", 0, 1, true] as TallyEntry] : []),
    ["TOGETHER_WHEN", time, 1, true],
    ["TOGETHER_WHEN", `${time}-${room}`, 1, false],
    ["TOGETHER_WHEN", `${time}-${where}`, 1, false],
  ];
  const want = WANTS[p.last.want];
  if (want && want !== "idle") out.push(["CHOOSE", want, 1, true], ["CHOOSE", `${want}-${room}`, 1, false]);
  if (needsMinOf(p) >= 250) out.push(["HEALTHY_DAY", localDay(now, p.tzOffsetMin), 1, false]);
  return out;
}

/** apps/web/src/game/world.ts countAway: the pet's own choices while away, as CHOOSE in the room the game was left in (G8). */
export function awayTally(room: number, wants: Readonly<Record<string, number>>): TallyEntry[] {
  return Object.entries(wants).flatMap(([want, n]): TallyEntry[] => [
    ["CHOOSE", want, n, true],
    ["CHOOSE", `${want}-${room}`, n, false],
  ]);
}

/** apps/web/src/game/quests.ts giverRoom: where each resident is found. */
export const GIVER_ROOM: Readonly<Record<string, number>> = { wick: 64, praline: 13, yonder: 3, bolt: 5, flit: 56, why: 59, jab: 89, twain: 19, nimbus: 53 };

/** apps/web/src/play/Talk.tsx: a conversation with a resident counts once. */
export const talkTally = (who: string): TallyEntry[] => [["TALK", who, 1, true]];

/** apps/web/src/play/Builders.tsx: a look at a builder's pet on Builders' Lane, and the day it was made. */
export const meetTally = (id: string, now: number, tzOffsetMin: number): TallyEntry[] => [
  ["MEET", id, 1, true],
  ["MEET_DAY", `${id}-${localDay(now, tzOffsetMin)}`, 1, false],
];

/** apps/web/src/game/quests.ts conditionViewFrom, for one pet raised alone, off chain, with no friends' pets. */
export function viewOf(w: WorldState, p: Pet, now: number): ConditionView {
  return {
    world: w,
    pet: { level: growthOf(p).level, stage: stageOf(p, now), onChain: false, needsMin: needsMinOf(p) },
    pets: 1,
    now,
    timeOfDay: timeOfDay(localHour(p, Math.floor(now / 60_000))) as 0 | 1 | 2 | 3,
    day: localDay(now, p.tzOffsetMin),
    bondLevel: 0,
    goalsDone: [],
  };
}
