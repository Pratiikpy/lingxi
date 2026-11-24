/**
 * Finds lessons a pet can be taught to beat Behemoth (row B1), and writes src/behemothCounter.generated.ts. Behemoth's
 * moves are a fixed sequence from its CPU, so a pet can learn it; this proves one adult's worth of lessons on one egg
 * line does, by the same evolutionary search the designed partners' counters use (designer.ts), scored on seeds the
 * test never sees.
 *
 *   npx tsx scripts/behemoth-counter.ts
 */

import { writeFileSync } from "node:fs";
import { type Program, compileProgram, gateCount } from "@lingxi/brain";
import {
  CURRENT_SPAR,
  LESSON_CAPACITY,
  MAX_GATES,
  behemothFighter,
  composeProgram,
  fight,
  fighterFrom,
  mutateProgram,
  seedProgram,
  stream,
} from "../src";

const LINES = ["gentle", "bold", "curious"] as const;
const TRAIN = Array.from({ length: 16 }, (_, i) => 11 + i * 9973);
const TEST = Array.from({ length: 40 }, (_, i) => 1009 + i * 104729);
const LEVEL = 1;

let best = { line: "gentle" as (typeof LINES)[number], rules: [] as Program["rules"], test: 0 };
for (const line of LINES) {
  const rnd = stream(0xbe00 + LINES.indexOf(line));
  const brain = (p: Program) => composeProgram(line, p.rules);
  const fits = (p: Program) => {
    try {
      return gateCount(compileProgram(brain(p))) <= MAX_GATES;
    } catch {
      return false;
    }
  };
  const wins = (p: Program, seeds: number[]) =>
    seeds.filter(
      (s) => fight(CURRENT_SPAR, fighterFrom("me", brain(p), LEVEL), behemothFighter("Behemoth"), s).winner === 0,
    ).length / seeds.length;
  let pop: { p: Program; f: number }[] = [];
  while (pop.length < 16) {
    const p = seedProgram(rnd, LESSON_CAPACITY.adult);
    if (fits(p)) pop.push({ p, f: wins(p, TRAIN) });
  }
  for (let g = 0; g < 40; g++) {
    pop.sort((a, b) => b.f - a.f);
    const parents = pop.slice(0, 4);
    const next = [...parents];
    for (let tries = 0; next.length < 16 && tries < 300; tries++) {
      const c = mutateProgram(parents[rnd() % parents.length]!.p, rnd, LESSON_CAPACITY.adult);
      if (fits(c)) next.push({ p: c, f: wins(c, TRAIN) });
    }
    pop = next;
  }
  pop.sort((a, b) => b.f - a.f);
  const test = wins(pop[0]!.p, TEST);
  process.stdout.write(
    `${line}: ${pop[0]!.p.rules.length} lessons, train ${pop[0]!.f.toFixed(3)}, test ${test.toFixed(3)}\n`,
  );
  if (test > best.test) best = { line, rules: pop[0]!.p.rules, test };
}

writeFileSync(
  "src/behemothCounter.generated.ts",
  `/* Written by scripts/behemoth-counter.ts; re-run it to reproduce. Do not edit by hand. */\n\nimport type { Rule } from "@lingxi/brain";\n\n/** Lessons a pet of this line can be taught to beat Behemoth, and the share of unseen spars they win. */\nexport const BEHEMOTH_COUNTER: { line: "gentle" | "bold" | "curious"; lessons: Rule[]; wins: number } = ${JSON.stringify({ line: best.line, lessons: best.rules, wins: Number(best.test.toFixed(4)) })};\n`,
);
process.stdout.write(`wrote ${best.line}, wins ${best.test.toFixed(3)}\n`);
