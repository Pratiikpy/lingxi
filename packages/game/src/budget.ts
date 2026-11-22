/**
 * The brain's gate budget as something the player can see (PRD F6). A brain has
 * at most its gate budget of NAND gates (500, more with Mind skills; TapeOut cost and on-chain step gas), and the
 * compiler shares any logic two rules have in common, so a lesson that reuses
 * what the pet already checks costs fewer gates than it would on its own.
 */

import { type Program, type Rule, compileProgram, gateCount } from "@lingxi/brain";
import { type MindSpec, halvesOf, mindExtra, taughtGates } from "./family";
import { composeProgram } from "./lessons";
import { gateBudget, skillRules, taughtBudget } from "./skills";
import type { Stage } from "./pet";

function programsOf(spec: MindSpec, lessons: readonly Rule[]): Program[] {
  return spec.family ? halvesOf(spec.family, lessons, skillRules(spec.growth)) : [composeProgram(spec.line, lessons, spec.instincts, mindExtra(spec.growth))];
}

/** Gates of the larger program (a child's two halves are separate circuits). */
const gatesOf = (ps: Program[]) => Math.max(...ps.map((p) => gateCount(compileProgram(p))));

export interface BrainSize {
  /** the whole circuit, against the on-chain limit */
  gates: number;
  max: number;
  /** G7: what its lessons add, against what its stage and Mind skills allow */
  taught: number;
  taughtMax: number;
}

export function brainSize(spec: MindSpec, stage: Exclude<Stage, "egg"> = "elder"): BrainSize {
  return { gates: gatesOf(programsOf(spec, spec.lessons)), max: gateBudget(spec.growth), taught: taughtGates(spec), taughtMax: taughtBudget(stage, spec.growth) };
}

export interface LessonCost {
  /** gates the brain grows by when this lesson is added to everything it knows */
  adds: number;
  /** what the lesson would cost on a brain that knows nothing else taught */
  alone: number;
  /** gates saved by sharing logic with what it already knows (never negative) */
  saved: number;
  /** the brain's size after the lesson */
  total: number;
  /** G7: the taught gates after the lesson, and the stage's taught budget */
  taught: number;
  taughtMax: number;
  fits: boolean;
}

export function lessonCost(spec: MindSpec, candidate: Rule, stage: Exclude<Stage, "egg"> = "elder"): LessonCost {
  const before = gatesOf(programsOf(spec, spec.lessons));
  const after = gatesOf(programsOf(spec, [candidate, ...spec.lessons]));
  const bare = gatesOf(programsOf(spec, []));
  const alone = gatesOf(programsOf(spec, [candidate])) - bare;
  const adds = after - before;
  const taught = taughtGates(spec, [candidate, ...spec.lessons]);
  const taughtMax = taughtBudget(stage, spec.growth);
  return { adds, alone, saved: Math.max(0, alone - adds), total: after, taught, taughtMax, fits: after <= gateBudget(spec.growth) && taught <= taughtMax };
}

/**
 * G7: the lessons a pet could forget to make room for this one (index into its lessons), the ones that leave the
 * candidate fitting both budgets; empty when forgetting one lesson is not enough.
 */
export function roomMakers(spec: MindSpec, candidate: Rule, stage: Exclude<Stage, "egg">): number[] {
  const out: number[] = [];
  spec.lessons.forEach((_, i) => {
    const rest = { ...spec, lessons: spec.lessons.filter((__, k) => k !== i) };
    if (lessonCost(rest, candidate, stage).fits) out.push(i);
  });
  return out;
}
