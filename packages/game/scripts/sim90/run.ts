/** The whole simulation: the five players, the spar field and the lesson watch, from one seed. Pure local computation. */

import { PLAYER_TYPES, type PlayerNumbers, type PlayerType, type SimNumbers } from "../../src";
import { sparField } from "./field";
import { costOfEverything } from "./life";
import { worthFindings } from "@lingxi/world";
import { TAP_PATHS, type TapPath, playType } from "./players";
import { lessonsSeen } from "./seen";
import { catchUp, care, createPet, mindBrain } from "../../src";
import { DAY1 } from "./players";

/**
 * G5: a pet of each line hatched on day 1's morning, cared for once (a pat), then left alone, lived by the game's own
 * catch-up hour by hour: its lowest need 72 hours later, and when it first falls ill (within ten days).
 */
function leftAlone(): Array<{ line: string; lowestAt72h: number; firstSickHours: number | null }> {
  const H = 3_600_000;
  const start = DAY1 + 8 * H;
  return (["gentle", "bold", "curious"] as const).map((line) => {
    const brain = mindBrain({ line, lessons: [] });
    let p = care(createPet({ name: "Alone", line, now: start, tzOffsetMin: 480, brain }), { kind: "pet" }, start, brain).pet;
    let lowestAt72h = 1000;
    let firstSickHours: number | null = null;
    for (let h = 1; h <= 240 && firstSickHours === null; h++) {
      p = catchUp(p, start + h * H, brain);
      if (h === 72) lowestAt72h = Math.min(...(["food", "joy", "energy", "clean"] as const).map((k) => Math.floor(p.meters[k] / 60)));
      if (p.sick) firstSickHours = h;
    }
    return { line, lowestAt72h, firstSickHours };
  });
}

/** Seeds per pairing in the spar field (two fights each): 16 left a field total of ~90% decided by noise. */
const FIELD_SEEDS = 32;
export const DEFAULT_SEED = 20261121;
export const DEFAULT_DAYS = 90;

/** The tapper down one tapping path (the pats-and-words tapper is the players' own). */
function tapPathNumbers(players: Record<PlayerType, PlayerNumbers>, seed: number, days: number, path: TapPath): { level99Day: number | null; day30Level: number | null } {
  const p = path === "petTalk" ? players.tapper : playType("tapper", seed, days, path);
  return { level99Day: p.level99Day, day30Level: p.days[Math.min(30, p.days.length) - 1]?.level ?? null };
}

/**
 * The same simulation, handing the event loop back between its pieces (each player, each tapping path, the field), so
 * a test runner's own messages are not held up for the whole run (B8 added three tappers to it).
 */
export async function runSimYielding(o: { seed?: number; days?: number } = {}): Promise<SimNumbers> {
  const seed = o.seed ?? DEFAULT_SEED;
  const days = o.days ?? DEFAULT_DAYS;
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const players = {} as Record<PlayerType, PlayerNumbers>;
  for (const t of PLAYER_TYPES) {
    players[t] = playType(t, seed, days);
    await tick();
  }
  const tapPaths: NonNullable<SimNumbers["tapPaths"]> = {};
  for (const path of TAP_PATHS) {
    tapPaths[path] = tapPathNumbers(players, seed, days, path);
    await tick();
  }
  const field = sparField(seed, FIELD_SEEDS);
  await tick();
  return { seed, days, players, tapPaths, field, lessons: lessonsSeen(), costOfEverything: costOfEverything(), alone: leftAlone(), worth: worthFindings().map((f) => f.why) };
}

export function runSim(o: { seed?: number; days?: number } = {}): SimNumbers {
  const seed = o.seed ?? DEFAULT_SEED;
  const days = o.days ?? DEFAULT_DAYS;
  const players = Object.fromEntries(PLAYER_TYPES.map((t) => [t, playType(t, seed, days)])) as Record<PlayerType, PlayerNumbers>;
  // B8: the tapper down each tapping path, for level-not-by-tapping
  const tapPaths = Object.fromEntries(TAP_PATHS.map((path) => [path, tapPathNumbers(players, seed, days, path)]));
  return { seed, days, players, tapPaths, field: sparField(seed, FIELD_SEEDS), lessons: lessonsSeen(), costOfEverything: costOfEverything(), alone: leftAlone(), worth: worthFindings().map((f) => f.why) };
}
