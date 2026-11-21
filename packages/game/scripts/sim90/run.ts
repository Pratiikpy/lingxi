/** The whole simulation: the five players, the spar field and the lesson watch, from one seed. Pure local computation. */

import { PLAYER_TYPES, type PlayerNumbers, type PlayerType, type SimNumbers } from "../../src";
import { sparField } from "./field";
import { costOfEverything } from "./life";
import { playType } from "./players";
import { lessonsSeen } from "./seen";

export const DEFAULT_SEED = 20261121;
export const DEFAULT_DAYS = 90;

export function runSim(o: { seed?: number; days?: number } = {}): SimNumbers {
  const seed = o.seed ?? DEFAULT_SEED;
  const days = o.days ?? DEFAULT_DAYS;
  const players = Object.fromEntries(PLAYER_TYPES.map((t) => [t, playType(t, seed, days)])) as Record<PlayerType, PlayerNumbers>;
  return { seed, days, players, field: sparField(seed), lessons: lessonsSeen(), costOfEverything: costOfEverything() };
}
