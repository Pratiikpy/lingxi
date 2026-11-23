/**
 * Spar win rates across a field of brains (plan G2), each fight the game's own `spar` (LX-SPAR/1) between fighters
 * built the way the game builds them (`fighterFrom` for a written program, `fighterOfPartner` for a partner).
 *
 * The field: every brain of one lesson (each fight lesson the coach suggests and each Pet School lesson, on each
 * egg line), the three starter brains, a brain that only ever makes one move for every move at every mood, a brain
 * written to read the fight, and the four sparring partners; and, as the plan's field also names (G2b), the school set
 * (each line taught the Pet School lessons in order, as many as a brain's budget holds) and sample taught pets (each
 * line taught by the coach, lesson after lesson to an adult's six, to fight each hand-written partner). Each pair fights on a fixed set of seeds from both sides;
 * a brain's win rate is its wins over all its fights (a draw is not a win). All pet brains fight at level 1, a teen's.
 */

import { type Program, type Rule, STARTERS, compileProgram, gateCount, validateProgram } from "@lingxi/brain";
import { FIGHT_LESSONS, type FieldBrain, type FieldNumbers, type Fighter, LESSON_CAPACITY, MAX_GATES, MOVES, PARTNERS, type Partner, PET_SCHOOL, coach, composeProgram, fighterFrom, fighterOfMind, fighterOfPartner, CURRENT_SPAR, fight } from "../../src";

const LINES = ["gentle", "bold", "curious"] as const;
const MOODS = ["grumpy", "calm", "happy", "excited"] as const;
const LEVEL = 1;

const only = (want: number, mood: number): Program => validateProgram({ version: "LX-PET/1", memory: [], rules: [], otherwise: { want, mood } });

/**
 * A brain that reads the fight: it guards after the other pounced, pounces at an opening or a tired foe, rests
 * when spent and snacks when hurt. Written for G0 from the fight's pins (spar.ts). One rule was changed after
 * measuring (D8): it snacked only when nearly beaten and lost the field to Pip, a plain pouncer, so it now snacks once
 * hurt (hunger 2), before chasing an opening; Pip's resting pace and excited late pounces were tried first and did not
 * help. That is the one change made to win; the rest is as written.
 * G2: from LX-SPAR/2 a guard shows on the action pins (spar2.ts), so the reader answers as the fight's triangle says: a
 * charm for a guard, a light tap for a dodger, and a pounce for a charm (in LX-SPAR/1 it guarded).
 */
export const READER: Program = validateProgram({
  version: "LX-PET/1",
  memory: [],
  rules: [
    { label: "spent: rest", when: { energy: [0] }, then: { want: 3, mood: 1 } },
    // D8: it reads its own wounds as well as the foe's moves: a snack once it is hurt (hunger 2, not only 3), before
    // chasing an opening; waiting until it was nearly beaten lost it fights a plain pouncer with Pip's pacing won
    { label: "hurt: snack", when: { hunger: [2, 3] }, then: { want: 1, mood: 1 } },
    { label: "an opening: pounce", when: { event: [2] }, then: { want: 2, mood: 2 } },
    { label: "it pounced: guard", when: { action: [2] }, then: { want: 5, mood: 1 } },
    { label: "it guarded: charm", when: { action: [3] }, then: { want: 6, mood: 1 } },
    { label: "it dodged: tap", when: { action: [6] }, then: { want: 0, mood: 1 } },
    { label: "it is worn down: pounce", when: { clean: [0, 1] }, then: { want: 2, mood: 2 } },
    { label: "charmed: pounce", when: { action: [5] }, then: { want: 2, mood: 1 } },
  ],
  otherwise: { want: 2, mood: 1 },
} as unknown);

/** The reader as it was written before row D8 (a snack only when nearly beaten), kept for the fights recorded with it. */
export const READER_BEFORE_D8: Program = validateProgram({
  ...READER,
  rules: [READER.rules[0]!, READER.rules[2]!, { ...READER.rules[1]!, when: { hunger: [3] } }, ...READER.rules.slice(3)],
} as unknown);

interface Entry {
  id: string;
  kind: FieldBrain["kind"];
  fighter: Fighter;
}

/** A line taught the school lessons in order, as many as fit a brain's gate budget. */
function schoolSet(line: (typeof LINES)[number]): Rule[] {
  const taught: Rule[] = [];
  for (const l of PET_SCHOOL) if (gateCount(compileProgram(composeProgram(line, [...taught, l.rule]))) <= MAX_GATES) taught.push(l.rule);
  return taught;
}

/** A line taught by the coach to fight a partner: lesson after lesson, each one it suggests after a lost practice spar. */
function coached(line: (typeof LINES)[number], partner: Partner): Rule[] {
  const lessons: Rule[] = [];
  for (let k = 0; k < LESSON_CAPACITY.adult; k++) {
    let lesson: Rule | undefined;
    for (let s = 0; s < 6 && !lesson; s++) {
      const r = fight(CURRENT_SPAR, fighterOfMind("me", { line, lessons }, LEVEL), fighterOfPartner(partner), 1000 + s);
      if (r.winner !== 0) lesson = coach({ result: r, side: 0, line, stage: "adult", lessons, level: LEVEL, opponent: fighterOfPartner(partner) }).lesson?.rule;
    }
    if (!lesson) break;
    lessons.unshift(lesson);
  }
  return lessons;
}

export function field(): Entry[] {
  const one = (id: string, line: (typeof LINES)[number], rule: Rule): Entry => ({ id: `${id}/${line}`, kind: "single", fighter: fighterFrom(id, composeProgram(line, [rule]), LEVEL) });
  const taught = (id: string, line: (typeof LINES)[number], lessons: Rule[]): Entry => ({ id, kind: "taught", fighter: fighterOfMind(id, { line, lessons }, LEVEL) });
  return [
    ...LINES.flatMap((line) => FIGHT_LESSONS.map((l) => one(`fight:${l.id}`, line, l.rule))),
    ...LINES.flatMap((line) => PET_SCHOOL.map((l) => one(`school:${l.id}`, line, l.rule))),
    ...LINES.map((line): Entry => ({ id: `starter/${line}`, kind: "starter", fighter: fighterFrom(line, STARTERS[line], LEVEL) })),
    { id: "guard-only", kind: "guard", fighter: fighterFrom("guard", only(5, 1), LEVEL) },
    { id: "dodge-only", kind: "dodge", fighter: fighterFrom("dodge", only(4, 1), LEVEL) },
    { id: "pounce-only", kind: "pounce", fighter: fighterFrom("pounce", only(2, 1), LEVEL) },
    // row B1: every other one-move brain, every move at every mood (mood is part of what a brain answers)
    ...MOVES.flatMap((move, want) =>
      MOODS.flatMap((mood, m): Entry[] => (m === 1 && (want === 2 || want === 4 || want === 5) ? [] : [{ id: `${move}-only/${mood}`, kind: "single", fighter: fighterFrom(move, only(want, m), LEVEL) }])),
    ),
    { id: "reader", kind: "reader", fighter: fighterFrom("reader", READER, LEVEL) },
    ...PARTNERS.map((p): Entry => ({ id: `partner:${p.id}`, kind: "partner", fighter: fighterOfPartner(p) })),
    ...LINES.map((line) => taught(`school-set/${line}`, line, schoolSet(line))),
    ...LINES.flatMap((line) => PARTNERS.map((p) => taught(`coached/${line}/${p.id}`, line, coached(line, p)))),
  ];
}

/** Wins of each side when `a` and `b` fight over the seeds, each starting from each side in turn. */
export function bout(a: Fighter, b: Fighter, seeds: readonly number[]): [number, number] {
  const w: [number, number] = [0, 0];
  for (const s of seeds) {
    const first = fight(CURRENT_SPAR, a, b, s).winner;
    const second = fight(CURRENT_SPAR, b, a, s ^ 0x2545f491).winner;
    if (first === 0) w[0]++;
    if (first === 1) w[1]++;
    if (second === 1) w[0]++;
    if (second === 0) w[1]++;
  }
  return w;
}

/** Head-to-head targets are read over this many seeds (two fights each), so a coin-flip dodge is not judged on noise. */
const HEAD_SEEDS = 100;

export function sparField(seed: number, nSeeds = 8): FieldNumbers {
  const seeds = Array.from({ length: nSeeds }, (_, i) => (seed + i * 104_729) >>> 0);
  const headSeeds = Array.from({ length: HEAD_SEEDS }, (_, i) => (seed ^ 0x5bd1e995) + i * 7919 >>> 0);
  const all = field();
  const won = new Map<string, number>(all.map((e) => [e.id, 0]));
  const played = 2 * nSeeds * (all.length - 1);
  /** beat[i][j]: the share of their fights brain i won against brain j */
  const beat = all.map(() => new Array<number>(all.length).fill(0));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      const [aw, bw] = bout(a.fighter, b.fighter, seeds);
      won.set(a.id, won.get(a.id)! + aw);
      won.set(b.id, won.get(b.id)! + bw);
      beat[i]![j] = aw / (2 * nSeeds);
      beat[j]![i] = bw / (2 * nSeeds);
    }
  }
  const brains: FieldBrain[] = all.map((e) => ({ id: e.id, kind: e.kind, winRate: won.get(e.id)! / played }));
  const best = (of: FieldBrain[]) => [...of].sort((a, b) => b.winRate - a.winRate)[0]!;
  const single = best(brains.filter((b) => ["single", "guard", "dodge", "pounce"].includes(b.kind)));
  const other = best(brains.filter((b) => b.kind !== "reader"));
  const rate = (id: string) => brains.find((b) => b.id === id)!.winRate;
  const head = (a: string, b: string) => {
    const fa = all.find((e) => e.id === a)!.fighter;
    const fb = all.find((e) => e.id === b)!.fighter;
    return bout(fa, fb, headSeeds)[0] / (2 * HEAD_SEEDS);
  };
  const isSingle = (k: FieldBrain["kind"]) => k === "single" || k === "guard" || k === "dodge" || k === "pounce";
  const r = all.findIndex((e) => e.id === "reader");
  const answers = all.flatMap((e, i) => {
    if (!isSingle(e.kind)) return [];
    const by = all.map((_, j) => (j === i ? -1 : beat[j]![i]!)).reduce((bj, v, j, arr) => (v > arr[bj]! ? j : bj), i === 0 ? 1 : 0);
    return [{ id: e.id, by: all[by]!.id, winRate: beat[by]![i]! }];
  });
  const leastAnswered = answers.reduce((m, a) => (a.winRate < m.winRate ? a : m));
  const beatReader = all.filter((e, i) => isSingle(e.kind) && beat[i]![r]! > beat[r]![i]!).map((e) => e.id);
  return {
    brains,
    seeds: nSeeds,
    bestSingle: { id: single.id, winRate: single.winRate },
    leastAnswered,
    beatReader,
    bestOther: { id: other.id, winRate: other.winRate },
    reader: rate("reader"),
    guardVsPounce: head("guard-only", "pounce-only"),
    dodgeVsPounce: head("dodge-only", "pounce-only"),
    guardVsField: rate("guard-only"),
    dodgeVsField: rate("dodge-only"),
  };
}
