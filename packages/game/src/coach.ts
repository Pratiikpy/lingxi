/**
 * The spar coach. After a loss it says why in one line, then finds the lesson
 * that would actually have helped: it tries every fight lesson the pet has room
 * for against the same partner over a fixed set of practice seeds and suggests
 * the one that wins the most. The numbers it shows are measured, not guessed.
 */

import { type Growth, sparMods } from "./skills";
import { type Rule, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import type { StarterLine } from "@lingxi/brain";
import type { OutsideInstinct, Stage } from "./pet";
import { checkMindLesson, mindBrain } from "./family";
import type { Family } from "./pet";
import { type Fighter, type FighterMods, type SparResult, type SparVersion } from "./spar";
import { CURRENT_SPAR, MOVE_COST, fight, rulesOf } from "./spar2";
import { partnerProgram } from "./partners";

export type CoachKey = "tooPassive" | "noDefence" | "ranOut" | "noHealing" | "outmatched" | "wellDone";

export interface FightLesson {
  id: string;
  label: { en: string; zh: string };
  rule: Rule;
}

const R = (when: Rule["when"], want: number, mood: number, nudge = 0): Rule => ({ when, then: { want, mood, nudge } }) as Rule;

/** Lessons that read the fight pins; each also changes everyday behaviour in the same way. */
export const FIGHT_LESSONS: readonly FightLesson[] = [
  { id: "guardHit", label: { en: "guards after a big scare", zh: "受惊后会防守" }, rule: R({ event: [3] }, 5, 1, 4) },
  { id: "opening", label: { en: "pounces at a toy or an opening", zh: "看到机会就扑上去" }, rule: R({ event: [2], energy: [1, 2, 3] }, 2, 3, 5) },
  { id: "restTired", label: { en: "rests when worn out", zh: "累了就休息" }, rule: R({ energy: [0] }, 3, 1, 4) },
  { id: "snackHurt", label: { en: "eats when very hungry", zh: "很饿时会吃东西" }, rule: R({ hunger: [2, 3] }, 1, 1) },
  { id: "finish", label: { en: "plays hard when the other is tired out", zh: "对方没力气时用力玩" }, rule: R({ clean: [0, 1], energy: [1, 2, 3] }, 2, 3, 5) },
  { id: "charmMorning", label: { en: "cuddles up in the morning", zh: "早上爱撒娇" }, rule: R({ time: [1] }, 6, 2, 6) },
  { id: "dodge", label: { en: "hops away from rough play", zh: "躲开粗鲁的玩闹" }, rule: R({ action: [2] }, 4, 2, 2) },
  { id: "fresh", label: { en: "plays when full of energy", zh: "精力充沛时就玩" }, rule: R({ energy: [3] }, 2, 2, 5) },
  { id: "guardTired", label: { en: "hides when a bit tired", zh: "有点累时躲起来" }, rule: R({ energy: [1] }, 5, 1) },
  { id: "ahead", label: { en: "plays harder when it's going well", zh: "顺利时玩得更起劲" }, rule: R({ joy: [2, 3] }, 2, 3, 5) },
];

/**
 * Practice spars the coach fights for each lesson. G2: 24 picked the luckiest of ten lessons often enough that a
 * suggestion could lose more fights on fresh seeds than the pet did before; 96, with a clear margin, does not.
 */
export const PRACTICE_SEEDS = 96;
/** A lesson is suggested only when it wins at least this many more practice spars than the pet does now. */
export const COACH_MARGIN = 5;

/** What each lesson fixes, so the coach's explanation matches its suggestion. */
const FIXES: Record<string, CoachKey> = {
  guardHit: "noDefence",
  guardTired: "noDefence",
  dodge: "noDefence",
  restTired: "ranOut",
  snackHurt: "noHealing",
  opening: "tooPassive",
  finish: "tooPassive",
  fresh: "tooPassive",
  ahead: "tooPassive",
  charmMorning: "tooPassive",
};

export interface CoachNote {
  key: CoachKey;
  lesson?: FightLesson;
  /** when the mind is full: the lesson (its index in the pet's lessons) to swap out for `lesson` (B2) */
  replace?: number;
  /** wins out of PRACTICE_SEEDS before and after the suggested lesson */
  before: number;
  after: number;
}

/** A fighter from any pet's mind, single or a child of two parents. */
export function fighterOfMind(name: string, spec: { line: StarterLine; lessons: readonly Rule[]; family?: Family; instincts?: number; outside?: OutsideInstinct; growth?: Growth }, level: number, memory?: readonly number[]): Fighter {
  const b = mindBrain(spec);
  const mods = fighterMods(spec.growth);
  return { name, brain: b.fast, memory: memory ? [...memory] : new Array(b.nState).fill(0), level, ...(mods ? { mods } : {}) };
}

/** What a pet's Spar skills bring to a fight (plan 4.4), or nothing for a pet without them, so its fights are unchanged. */
export function fighterMods(growth: Growth | undefined): FighterMods | undefined {
  const m = sparMods(growth);
  const { winCoins: _w, lossCoins: _l, ...fight } = m;
  return Object.values(fight).some((v) => v !== 0) ? fight : undefined;
}

/** The fighter for a sparring partner: its program, or both halves of a friend's child. */
/** A partner as a fighter, with its brain for the fight's version (B3b). */
export function fighterOfPartner(p: { name: { en: string }; line: StarterLine; level: number; program: import("@lingxi/brain").Program; programBefore3?: import("@lingxi/brain").Program; family?: Family; lessons?: Rule[]; instincts?: number; outside?: OutsideInstinct }, version: SparVersion = CURRENT_SPAR): Fighter {
  return p.family || p.outside ? fighterOfMind(p.name.en, { line: p.line, lessons: p.lessons ?? [], family: p.family, instincts: p.instincts, outside: p.outside }, p.level) : fighterFrom(p.name.en, partnerProgram(p, version), p.level);
}

export function fighterFrom(name: string, program: import("@lingxi/brain").Program, level: number, memory?: readonly number[]): Fighter {
  return { name, brain: fastBrain(compileProgram(program)), memory: memory ? [...memory] : new Array(stateBits(program)).fill(0), level };
}

/** Practice spars in the version the fight was fought in, so the advice holds for the fight it is about (B3). */
function winsAgainst(me: Fighter, them: Fighter, base: number, version: SparVersion = CURRENT_SPAR): number {
  let w = 0;
  for (let i = 0; i < PRACTICE_SEEDS; i++) if (fight(version, me, them, base + i * 7919).winner === 0) w++;
  return w;
}

function diagnose(r: SparResult, side: 0 | 1): CoachKey {
  const mine = r.rounds.map((x) => x.moves[side]);
  const theirs = r.rounds.map((x) => x.moves[1 - side]!);
  // spent: LX-SPAR/1 forced a rest only at no stamina; from LX-SPAR/2 at less than a pounce costs
  const exhausted = r.rounds.filter((x) => x.stamina[side]! <= (rulesOf(r.version) ? MOVE_COST.pounce - 1 : 0)).length;
  const bigHits = r.rounds.filter((x) => x.hits[1 - side]! >= 14).length;
  const guarded = mine.filter((m) => m === "guard" || m === "dodge").length;
  const missed = r.rounds.filter((_, i) => i > 0 && ["rest", "snack"].includes(theirs[i - 1]!) && mine[i] !== "pounce").length;
  const lowNoHeal = r.rounds.filter((x, i) => x.hp[side]! < 40 && mine[i] !== "snack").length;
  const scores: Array<[CoachKey, number]> = [
    ["ranOut", exhausted * 2],
    ["noDefence", bigHits >= 3 && guarded <= 1 ? bigHits * 2 : 0],
    ["tooPassive", missed * 2],
    ["noHealing", lowNoHeal],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]![1] > 0 ? scores[0]![0] : "outmatched";
}

export function coach(input: {
  result: SparResult;
  side: 0 | 1;
  line: StarterLine;
  stage: Exclude<Stage, "egg">;
  lessons: readonly Rule[];
  level: number;
  memory?: readonly number[];
  family?: Family;
  outside?: OutsideInstinct;
  instincts?: number;
  /** levels and skills, and any quest slots: the coach suggests only lessons the pet could really learn */
  growth?: Growth;
  slots?: number;
  opponent: Fighter;
}): CoachNote {
  const { result, side, line, stage, lessons, level, opponent } = input;
  const seed = result.seed;
  if (result.winner === side) return { key: "wellDone", before: 0, after: 0 };
  const spec = { line, lessons, family: input.family, instincts: input.instincts, outside: input.outside, growth: input.growth, slots: input.slots };
  const now = fighterOfMind("me", spec, level, input.memory);
  const before = winsAgainst(now, opponent, seed, result.version);
  let best: { lesson: FightLesson; wins: number } | null = null;
  for (const l of FIGHT_LESSONS) {
    const check = checkMindLesson(spec, stage, l.rule);
    if (!check.ok) continue;
    const wins = winsAgainst(fighterOfMind("me", { ...spec, lessons: [l.rule, ...lessons] }, level), opponent, seed, result.version);
    if (wins >= before + COACH_MARGIN && (!best || wins > best.wins)) best = { lesson: l, wins };
  }
  if (best) return { key: FIXES[best.lesson.id] ?? diagnose(result, side), lesson: best.lesson, before, after: best.wins };
  // nothing it has room for helps (or it has no room): try each lesson it holds swapped for each fight lesson, the new one
  // on top as a swap teaches it (B2), so the coach never says nothing helps when a swap would
  let swap: { lesson: FightLesson; replace: number; wins: number } | null = null;
  for (let i = 0; i < lessons.length; i++) {
    const rest = lessons.filter((_, k) => k !== i);
    for (const l of FIGHT_LESSONS) {
      if (lessons.some((x) => JSON.stringify([x.when, x.then]) === JSON.stringify([l.rule.when, l.rule.then]))) continue;
      if (!checkMindLesson({ ...spec, lessons: rest }, stage, l.rule).ok) continue;
      const wins = winsAgainst(fighterOfMind("me", { ...spec, lessons: [l.rule, ...rest] }, level), opponent, seed, result.version);
      if (wins >= before + COACH_MARGIN && (!swap || wins > swap.wins)) swap = { lesson: l, replace: i, wins };
    }
  }
  if (swap) return { key: FIXES[swap.lesson.id] ?? diagnose(result, side), lesson: swap.lesson, replace: swap.replace, before, after: swap.wins };
  return { key: diagnose(result, side), before, after: before };
}

