/** The whole simulation: the five players, the spar field and the lesson watch, from one seed. Pure local computation. */

import { PLAYER_TYPES, type PlayerNumbers, type PlayerType, type SimNumbers } from "../../src";
import { sparField } from "./field";
import { costOfEverything } from "./life";
import { worthFindings } from "@lingxi/world";
import { TAP_PATHS, type TapPath, playType } from "./players";
import { lessonsSeen } from "./seen";
import { type BudgetChoice, LESSON_CAPACITY, PET_SCHOOL, catchUp, care, createPet, mindBrain, stageOf, taughtBudget, taughtGates } from "../../src";
import { DAY1 } from "./players";

/**
 * G5: a pet of each line hatched on day 1's morning, cared for once (a pat), then left alone, lived by the game's own
 * catch-up hour by hour: its lowest need 72 hours later, and when it first falls ill (within ten days).
 */
/** D1: the review's probe, a pet patted every 93.6 hours and nothing else, for 62 days. */
function patOnly(): { stageDay62: string; ill: boolean; mistakes: number } {
  const H = 3_600_000;
  const start = DAY1 + 8 * H;
  const brain = mindBrain({ line: "gentle", lessons: [] });
  let p = createPet({ name: "Patted", line: "gentle", now: start, tzOffsetMin: 480, brain });
  let ill = false;
  for (let t = 93.6 * H; t <= 62 * 24 * H; t += 93.6 * H) {
    p = care(p, { kind: "pet" }, start + Math.round(t), brain).pet;
    ill ||= !!p.sick;
  }
  p = catchUp(p, start + 62 * 24 * H, brain);
  return { stageDay62: stageOf(p, start + 62 * 24 * H), ill: ill || !!p.sick, mistakes: p.mistakes ?? 0 };
}

/**
 * D13: the gate budget as a choice, over every set of school lessons and every order they could be taught in (a set is
 * counted as fitting if its cheapest order fits): how many of the sets that fill a teen's four slots and an adult's six
 * fit with no Mind points and with five, and whether an elder can hold all eight with none. The first measure (D3) tried
 * one order only, and an order chosen well holds more (the reviewer's F1).
 */
function budgetChoice(): BudgetChoice {
  const school = PET_SCHOOL.map((s) => s.rule);
  const subsets = (k: number): number[][] => {
    const out: number[][] = [];
    const rec = (i: number, cur: number[]) => {
      if (cur.length === k) return void out.push([...cur]);
      for (let j = i; j < school.length; j++) rec(j + 1, [...cur, j]);
    };
    rec(0, []);
    return out;
  };
  const orders = (a: number[]): number[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => orders([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  const cheapest = (line: "gentle" | "bold" | "curious", set: number[]) => Math.min(...orders(set).map((o) => taughtGates({ line, lessons: o.map((i) => school[i]!) })));
  const mind = (points: number) => (points ? { level: 99, points: 0, skills: { 211: points } } : undefined);
  return Object.fromEntries(
    (["gentle", "bold", "curious"] as const).map((line) => {
      const teen = subsets(LESSON_CAPACITY.teen).map((s) => cheapest(line, s));
      const adult = subsets(LESSON_CAPACITY.adult).map((s) => cheapest(line, s));
      const fit = (costs: number[], stage: "teen" | "adult", points: number) => costs.filter((c) => c <= taughtBudget(stage, mind(points))).length;
      return [
        line,
        {
          teenSets: teen.length,
          teenNoMind: fit(teen, "teen", 0),
          teenFiveMind: fit(teen, "teen", 5),
          adultSets: adult.length,
          adultNoMind: fit(adult, "adult", 0),
          adultFiveMind: fit(adult, "adult", 5),
          elderAllEight: cheapest(line, school.map((_, i) => i)),
          elderBudget: taughtBudget("elder", undefined),
        },
      ];
    }),
  );
}

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
  return { seed, days, players, tapPaths, field, lessons: lessonsSeen(), costOfEverything: costOfEverything(), alone: leftAlone(), patOnly: patOnly(), budgetChoice: budgetChoice(), worth: worthFindings().map((f) => f.why) };
}

export function runSim(o: { seed?: number; days?: number } = {}): SimNumbers {
  const seed = o.seed ?? DEFAULT_SEED;
  const days = o.days ?? DEFAULT_DAYS;
  const players = Object.fromEntries(PLAYER_TYPES.map((t) => [t, playType(t, seed, days)])) as Record<PlayerType, PlayerNumbers>;
  // B8: the tapper down each tapping path, for level-not-by-tapping
  const tapPaths = Object.fromEntries(TAP_PATHS.map((path) => [path, tapPathNumbers(players, seed, days, path)]));
  return { seed, days, players, tapPaths, field: sparField(seed, FIELD_SEEDS), lessons: lessonsSeen(), costOfEverything: costOfEverything(), alone: leftAlone(), patOnly: patOnly(), budgetChoice: budgetChoice(), worth: worthFindings().map((f) => f.why) };
}
