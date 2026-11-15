/**
 * Designs one sparring partner per stage by search (PRD F27) and writes
 * src/designed.generated.ts. Each stage's search fights the hand-written
 * partners, the three starter brains and the partners already designed for
 * earlier stages. A design is kept only if a pet of that stage, holding no more
 * lessons than it is allowed, can be taught to beat it; the lessons that do it
 * are kept too, as the partner's hint.
 *
 *   npx tsx scripts/design-partners.ts
 */

import { writeFileSync } from "node:fs";
import type { Program } from "@lingxi/brain";
import { LESSON_CAPACITY, MAX_GATES, composeProgram } from "../src/lessons";
import { PARTNERS } from "../src/partners";
import { type DesignStage, STAGE_LEVEL, design, moveShares } from "../src/designer";

const STAGES: DesignStage[] = ["baby", "child", "teen", "adult"];
const LINES = ["gentle", "bold", "curious"] as const;
const TRAIN = [11, 23, 37, 41, 53, 67, 79, 97];
const TEST = Array.from({ length: 24 }, (_, i) => 1009 + i * 104729);
/** A partner must lose at least this share of fights to the best taught pet. */
const BEATABLE = 0.55;
/** Each stage's partner has its own way of fighting. */
const STYLE: Record<DesignStage, { move: string; share: number }> = {
  baby: { move: "dodge", share: 0.4 },
  child: { move: "pounce", share: 0.45 },
  teen: { move: "charm", share: 0.3 },
  adult: { move: "guard", share: 0.35 },
};

type Entry = { name: string; program: Program; level: number };
const pool: Entry[] = [...PARTNERS.map((p) => ({ name: p.id, program: p.program, level: p.level })), ...LINES.map((l) => ({ name: `starter-${l}`, program: composeProgram(l, []), level: 0 }))];
const starters = pool.slice();

const out: string[] = [];
for (const stage of STAGES) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const seed = 0x1a2b + STAGES.indexOf(stage) * 1000 + attempt;
    const t = Date.now();
    const d = design({ stage, seed, generations: 50, population: 16, pool, trainSeeds: TRAIN, testSeeds: TEST, hallEvery: 10, style: STYLE[stage] });
    // can a pet of this stage be taught to beat it?
    let counter = { line: "gentle" as (typeof LINES)[number], lessons: [] as Program["rules"], wins: 0 };
    for (const line of LINES) {
      const c = design({ stage, seed: seed ^ 0x77, generations: 40, population: 16, pool: [{ name: "partner", program: d.program, level: STAGE_LEVEL[stage] }], trainSeeds: TRAIN, testSeeds: TEST, compose: (p) => composeProgram(line, p.rules), gates: MAX_GATES, rules: LESSON_CAPACITY[stage], level: STAGE_LEVEL[stage] });
      if (c.test > counter.wins) counter = { line, lessons: c.program.rules, wins: c.test };
    }
    const vsStarters = d.test;
    const moves = moveShares(d.program, STAGE_LEVEL[stage], starters, TEST.slice(0, 8));
    process.stdout.write(`${stage} seed ${seed}: ${d.gates} gates, ${d.program.rules.length} rules, train ${d.train.toFixed(3)}, test ${vsStarters.toFixed(3)}, beatable ${counter.wins.toFixed(3)} (${counter.line}, ${counter.lessons.length} lessons), moves ${moves.slice(0, 3).map(([m, s]) => `${m} ${(s * 100).toFixed(0)}%`).join(" ")} [${Date.now() - t} ms]\n`);
    if (counter.wins < BEATABLE) continue;
    out.push(`  ${stage}: ${JSON.stringify({ seed, style: STYLE[stage], generations: d.generations, hall: d.hall, gates: d.gates, train: Number(d.train.toFixed(4)), test: Number(d.test.toFixed(4)), program: d.program, counter: { line: counter.line, lessons: counter.lessons, wins: Number(counter.wins.toFixed(4)) }, moves: moves.map(([m, s]) => [m, Number(s.toFixed(3))]) })},`);
    pool.push({ name: `designed-${stage}`, program: d.program, level: STAGE_LEVEL[stage] });
    break;
  }
}

writeFileSync(
  new URL("../src/designed.generated.ts", import.meta.url),
  `/* Written by scripts/design-partners.ts; re-run it to reproduce. Do not edit by hand. */\n\nimport type { Program, Rule } from "@lingxi/brain";\n\nexport interface DesignRecord {\n  seed: number;\n  generations: number;\n  hall: number;\n  gates: number;\n  train: number;\n  test: number;\n  program: Program;\n  counter: { line: "gentle" | "bold" | "curious"; lessons: Rule[]; wins: number };\n  moves: Array<[string, number]>;\n}\n\nexport const DESIGNED: Readonly<Record<string, DesignRecord>> = {\n${out.join("\n")}\n} as Record<string, DesignRecord>;\n`,
);
process.stdout.write(`wrote ${out.length} designs\n`);
