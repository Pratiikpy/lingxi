/**
 * G1: why it did that. The rule that won, named for where it came from: the player's own lesson, a parent's lesson (a
 * child's), an instinct switched on at hatching, a skill's rule, or the line it was born with (its starter rules and
 * its "otherwise"). Matched by what the rule says, so it holds whatever order the mind was built in.
 */

import type { Program, Rule } from "@lingxi/brain";
import { INSTINCT_RULES, type Pet, skillRules } from "@lingxi/game";

export type RuleKind = "taught" | "parent" | "instinct" | "skill" | "inborn";

const same = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

export function ruleKindOf(pet: Pet, program: Program, rule: number): RuleKind {
  const r = rule >= 0 ? program.rules[rule] : undefined;
  if (!r) return "inborn";
  if (pet.lessons.some((l) => same(l, r))) return "taught";
  if (pet.family?.parents.some((p) => p.lessons.some((l) => same(l, r)))) return "parent";
  if (Object.values(INSTINCT_RULES).some((l) => same(l, r))) return "instinct";
  if (skillRules(pet.growth).some((l) => same(l, r))) return "skill";
  return "inborn";
}
