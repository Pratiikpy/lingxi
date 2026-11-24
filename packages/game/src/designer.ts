/**
 * Sparring partners designed by search (PRD F27). A partner is a program in the
 * pet rule language; the search evolves it against a pool of opponents inside a
 * gate budget for its stage, so every designed partner is a brain a player's pet
 * could also hold at that stage.
 *
 * After TapeFly's lineage (sim/genome.ts, MIT): integers only, and a mutation is
 * a small nudge to a parent, never a re-roll, so a line of programs stays a line.
 * Two things are added. The pool grows a hall of fame of earlier champions, so a
 * partner has to beat strategies that beat the starting pool, not only the pool.
 * And fitness is measured on training seeds while the reported strength comes
 * from held-out seeds, so a partner cannot win by memorising a few fights.
 *
 * Everything is a function of the seed: anyone can re-run a design and get the
 * same program.
 */

import {
  type Clause,
  type Out,
  type Program,
  type Rule,
  INPUT_FIELDS,
  compileProgram,
  gateCount,
  validateProgram,
} from "@lingxi/brain";
import { fighterFrom } from "./coach";
import { type Fighter } from "./spar";
import { CURRENT_SPAR, fight } from "./spar2";

export type DesignStage = "baby" | "child" | "teen" | "adult";

/** Gates each stage's partner may use; the adult budget is the pet brain's own limit. */
export const STAGE_GATES: Readonly<Record<DesignStage, number>> = { baby: 90, child: 160, teen: 280, adult: 480 };
/** The level a partner fights at, as the hand-written partners do. */
export const STAGE_LEVEL: Readonly<Record<DesignStage, number>> = { baby: 0, child: 0, teen: 1, adult: 1 };
/** Rules a partner may hold at each stage. */
export const STAGE_RULES: Readonly<Record<DesignStage, number>> = { baby: 3, child: 5, teen: 8, adult: 12 };

export interface DesignOptions {
  stage: DesignStage;
  seed: number;
  generations: number;
  population: number;
  /** opponents to beat (programs and their levels) */
  pool: ReadonlyArray<{ name: string; program: Program; level: number }>;
  trainSeeds: readonly number[];
  testSeeds: readonly number[];
  /** a champion joins the opponents every this many generations */
  hallEvery?: number;
  /** how an evolved program becomes the fighting brain (default: as it is); used to search for a player's lessons */
  compose?: (p: Program) => Program;
  /** overrides the stage's gate budget and rule count */
  gates?: number;
  rules?: number;
  level?: number;
  /** a fighting style: this move must make up at least this share of the partner's turns */
  style?: { move: string; share: number };
}

export interface Design {
  stage: DesignStage;
  seed: number;
  program: Program;
  gates: number;
  /** share of fights won (a draw is half) on the training seeds, against the final pool */
  train: number;
  /** the same on held-out seeds, against the starting pool only */
  test: number;
  generations: number;
  hall: number;
}

/** A small deterministic stream (xorshift32), as TapeFly's sim/rand.ts. */
export function stream(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}
const pickInt = (rnd: () => number, lo: number, hi: number) => lo + (rnd() % (hi - lo + 1));

// "owner" in a spar is the crowd cheering, which a designed partner should not rely on
const FIELDS = INPUT_FIELDS.filter((f) => f.name !== "owner");

function randomCondition(rnd: () => number): [string, number[]] {
  const f = FIELDS[rnd() % FIELDS.length]!;
  const max = (1 << f.bits) - 1;
  const a = pickInt(rnd, 0, max);
  const b = Math.min(max, a + pickInt(rnd, 0, 1));
  return [f.name, Array.from({ length: b - a + 1 }, (_, i) => a + i)];
}
const randomOut = (rnd: () => number): Out => ({ want: rnd() % 8, mood: rnd() % 4 });
function randomRule(rnd: () => number): Rule {
  const when: Clause = {};
  const n = 1 + (rnd() % 2);
  for (let i = 0; i < n; i++) {
    const [k, v] = randomCondition(rnd);
    when[k] = v;
  }
  return { when, then: randomOut(rnd) };
}

/** A first program for a line of descent. */
export function seedProgram(rnd: () => number, maxRules: number): Program {
  const rules = Array.from({ length: Math.min(maxRules, 1 + (rnd() % 3)) }, () => randomRule(rnd));
  return validateProgram({ version: "LX-PET/1", memory: [], rules, otherwise: randomOut(rnd) });
}

/** One small change to a program: a nudged range, a different move or mood, a rule added, dropped or moved. */
export function mutateProgram(p: Program, rnd: () => number, maxRules: number): Program {
  const rules = p.rules.map((r) => ({
    when: Object.fromEntries(Object.entries(r.when).map(([k, v]) => [k, [...v]])),
    then: { ...r.then },
  }));
  let otherwise = { ...p.otherwise };
  const op = rnd() % 8;
  const i = rules.length ? rnd() % rules.length : 0;
  const r = rules[i];
  if (op === 0 && r) {
    // nudge one condition's range by one step
    const keys = Object.keys(r.when).filter((k) => FIELDS.some((x) => x.name === k));
    // a condition widened to every value is dropped by validation: give the rule a new one
    if (!keys.length) {
      const [k, v] = randomCondition(rnd);
      r.when[k] = v;
      return validateProgram({ version: "LX-PET/1", memory: [], rules, otherwise });
    }
    const k = keys[rnd() % keys.length]!;
    const f = FIELDS.find((x) => x.name === k)!;
    const max = (1 << f.bits) - 1;
    const v = r.when[k]!;
    let lo = v[0]!;
    let hi = v[v.length - 1]!;
    if (rnd() % 2) lo = Math.max(0, Math.min(hi, lo + (rnd() % 2 ? 1 : -1)));
    else hi = Math.min(max, Math.max(lo, hi + (rnd() % 2 ? 1 : -1)));
    r.when[k] = Array.from({ length: hi - lo + 1 }, (_, j) => lo + j);
  } else if (op === 1 && r) r.then = { ...r.then, want: rnd() % 8 };
  else if (op === 2 && r) r.then = { ...r.then, mood: rnd() % 4 };
  else if (op === 3 && rules.length < maxRules) rules.splice(rnd() % (rules.length + 1), 0, randomRule(rnd));
  else if (op === 4 && rules.length > 1) rules.splice(i, 1);
  else if (op === 5 && rules.length > 1) {
    const j = (i + 1) % rules.length;
    [rules[i], rules[j]] = [rules[j]!, rules[i]!];
  } else if (op === 6 && r) {
    // add or drop a condition
    const keys = Object.keys(r.when);
    if (keys.length > 1 && rnd() % 2) delete r.when[keys[rnd() % keys.length]!];
    else {
      const [k, v] = randomCondition(rnd);
      r.when[k] = v;
    }
  } else otherwise = rnd() % 2 ? { ...otherwise, want: rnd() % 8 } : { ...otherwise, mood: rnd() % 4 };
  return validateProgram({ version: "LX-PET/1", memory: [], rules, otherwise });
}

export const gatesOf = (p: Program): number => gateCount(compileProgram(p));

/** Share of fights won against these opponents on these seeds, playing each from both sides. */
export function strength(
  p: Program,
  level: number,
  pool: ReadonlyArray<{ name: string; program: Program; level: number }>,
  seeds: readonly number[],
): number {
  const me: Fighter = fighterFrom("designed", p, level);
  let score = 0;
  let fights = 0;
  for (const o of pool) {
    const them = fighterFrom(o.name, o.program, o.level);
    for (const s of seeds) {
      const a = fight(CURRENT_SPAR, me, them, s).winner;
      const b = fight(CURRENT_SPAR, them, me, s ^ 0x5bd1e995).winner;
      score += (a === 0 ? 1 : a === -1 ? 0.5 : 0) + (b === 1 ? 1 : b === -1 ? 0.5 : 0);
      fights += 2;
    }
  }
  return fights ? score / fights : 0;
}

/** Evolve one partner for a stage. */
export function design(o: DesignOptions): Design {
  const rnd = stream(o.seed);
  const level = o.level ?? STAGE_LEVEL[o.stage];
  const maxRules = o.rules ?? STAGE_RULES[o.stage];
  const budget = o.gates ?? STAGE_GATES[o.stage];
  const brain = (p: Program) => (o.compose ? o.compose(p) : p);
  const fits = (p: Program) => {
    try {
      return gatesOf(brain(p)) <= budget;
    } catch {
      return false;
    }
  };
  const pool = [...o.pool];
  let hall = 0;

  type Scored = { p: Program; f: number };
  const styleOf = (p: Program) => {
    if (!o.style) return 1;
    const got = moveShares(p, level, o.pool, o.trainSeeds.slice(0, 3)).find(([m]) => m === o.style!.move)?.[1] ?? 0;
    return got >= o.style.share ? 1 : got / o.style.share;
  };
  // strength counts only in full once the style is held; a brain that drifts from its style scores less
  const score = (p: Program): Scored => ({ p, f: strength(brain(p), level, pool, o.trainSeeds) * styleOf(brain(p)) });
  let pop: Scored[] = [];
  while (pop.length < o.population) {
    const p = seedProgram(rnd, maxRules);
    if (fits(p)) pop.push(score(p));
  }
  for (let g = 0; g < o.generations; g++) {
    pop.sort((a, b) => b.f - a.f);
    const parents = pop.slice(0, Math.max(2, o.population >> 2));
    const next: Scored[] = parents.map((x) => x);
    let tries = 0;
    while (next.length < o.population && tries++ < o.population * 20) {
      const parent = parents[rnd() % parents.length]!.p;
      let child = mutateProgram(parent, rnd, maxRules);
      if (rnd() % 3 === 0) child = mutateProgram(child, rnd, maxRules);
      if (fits(child)) next.push(score(child));
    }
    pop = next;
    if (o.hallEvery && (g + 1) % o.hallEvery === 0 && g + 1 < o.generations) {
      const best = [...pop].sort((a, b) => b.f - a.f)[0]!;
      pool.push({ name: `hall-${hall++}`, program: best.p, level });
      // the bar just rose: everyone is scored again against the larger pool
      pop = pop.map((x) => score(x.p));
    }
  }
  pop.sort((a, b) => b.f - a.f);
  const best = pop[0]!.p;
  return {
    stage: o.stage,
    seed: o.seed,
    program: best,
    gates: gatesOf(brain(best)),
    train: strength(brain(best), level, pool, o.trainSeeds),
    test: strength(brain(best), level, o.pool, o.testSeeds),
    generations: o.generations,
    hall,
  };
}

/** How a fighter spends its turns over some fights: each move's share, most used first. */
export function moveShares(
  p: Program,
  level: number,
  pool: ReadonlyArray<{ name: string; program: Program; level: number }>,
  seeds: readonly number[],
): Array<[string, number]> {
  const me = fighterFrom("designed", p, level);
  const tally: Record<string, number> = {};
  let n = 0;
  for (const o of pool)
    for (const s of seeds)
      for (const r of fight(CURRENT_SPAR, me, fighterFrom(o.name, o.program, o.level), s).rounds) {
        tally[r.moves[0]] = (tally[r.moves[0]] ?? 0) + 1;
        n++;
      }
  return Object.entries(tally)
    .map(([m, c]) => [m, c / n] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}
