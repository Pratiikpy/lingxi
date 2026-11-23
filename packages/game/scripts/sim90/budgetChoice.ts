/**
 * D13's exhaustive gate-budget measure (every set of school lessons in every order, about 186,000 compiles), kept in a
 * cache beside it: it depends only on the school's lessons, the budgets, the lesson slots, the Mind skills' share and the
 * compiler, so it is computed once for those and read back after. A test fails when the cache no longer matches them
 * (run `npx tsx scripts/sim90.ts --write`). Computing it inside every simulator run took the balance test past seven
 * minutes and timed out its worker.
 */

import { writeFileSync } from "node:fs";
import { compileProgram, gateCount } from "@lingxi/brain";
import { type BudgetChoice, LESSON_CAPACITY, PET_SCHOOL, TAUGHT_BUDGET, TAUGHT_SHARE, composeProgram, taughtBudget, taughtGates } from "../../src";
import { BUDGET_CHOICE_CACHE } from "./budgetChoice.generated";

/** What the measure depends on, as one string: change any of it and the cache is stale. */
export function budgetChoiceKey(): string {
  const school = PET_SCHOOL.map((s) => s.rule);
  const compiler = (["gentle", "bold", "curious"] as const).map((l) => [gateCount(compileProgram(composeProgram(l, []))), gateCount(compileProgram(composeProgram(l, school)))]);
  return JSON.stringify({ school, budget: TAUGHT_BUDGET, slots: LESSON_CAPACITY, share: TAUGHT_SHARE, wide: taughtBudget("teen", { level: 99, points: 0, skills: { 211: 1 } }), compiler });
}

/**
 * D13: the gate budget as a choice, over every set of school lessons and every order they could be taught in (a set is
 * counted as fitting if its cheapest order fits): how many of the sets that fill a teen's four slots and an adult's six
 * fit with no Mind points and with five, and whether an elder can hold all eight with none. The first measure (D3) tried
 * one order only, and an order chosen well holds more (the reviewer's F1).
 */
export function computeBudgetChoice(): BudgetChoice {
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

/** The measure: from the cache when it is current, computed otherwise. */
export function budgetChoice(): BudgetChoice {
  return BUDGET_CHOICE_CACHE.key === budgetChoiceKey() ? BUDGET_CHOICE_CACHE.value : computeBudgetChoice();
}

/** Recompute and rewrite the cache (the simulator's --write does this). */
export function writeBudgetChoiceCache(): BudgetChoice {
  const value = computeBudgetChoice();
  writeFileSync(
    new URL("./budgetChoice.generated.ts", import.meta.url),
    `/* Written by scripts/sim90.ts --write (budgetChoice.ts); re-run it to reproduce. Do not edit by hand. */\n\nimport type { BudgetChoice } from "../../src";\n\nexport const BUDGET_CHOICE_CACHE: { key: string; value: BudgetChoice } = ${JSON.stringify({ key: budgetChoiceKey(), value }, null, 2)};\n`,
  );
  return value;
}
