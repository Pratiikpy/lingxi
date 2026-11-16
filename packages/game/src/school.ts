/**
 * Pet School goals (PRD F8) and trap orders (PRD F7).
 *
 * Every Pet School lesson is a level with three goals: three situations the pet
 * should meet the lesson's way. A goal is checked by running the pet's own
 * brain on that situation, so a star is earned by the circuit, not by a tick in
 * a list. Each lesson's solution is tested on all three egg lines (see
 * school.test.ts): learned alone, it earns all three stars.
 *
 * Order is the strategy. Lessons are checked top to bottom, so a lesson placed
 * above another can answer first in the other's situations and take its stars
 * away. That is a trap order; we name the lesson that gets in the way.
 */

import { type Program, type Rule, encodeSenses, runBeat, stateBits } from "@lingxi/brain";
import { type MindSpec, halvesOf, mindExtra } from "./family";
import { skillRules } from "./skills";
import { PET_SCHOOL, composeProgram } from "./lessons";

type Senses = { hunger: number; joy: number; energy: number; clean: number; time: number; action: number; event: number; owner: number };

export interface Goal {
  say: { en: string; zh: string };
  senses: Partial<Senses>;
  /** memory to set going in, by name (e.g. trust 0) */
  memory?: Record<string, number>;
  /** the want the pet should choose, or must not choose when `not` is set */
  want: number;
  not?: boolean;
}

const CALM: Senses = { hunger: 0, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 0, owner: 1 };

export const SCHOOL_GOALS: Readonly<Record<string, readonly [Goal, Goal, Goal]>> = {
  share: [
    { say: { en: "A friend comes by while it's happy: it shares", zh: "开心的时候朋友来了：它会分享" }, senses: { event: 1, joy: 2 }, want: 7 },
    { say: { en: "A friend comes by on a low day: it still shares", zh: "心情低落时朋友来了：它还是分享" }, senses: { event: 1, joy: 1 }, want: 7 },
    { say: { en: "It shares even when you're away", zh: "你不在的时候也会分享" }, senses: { event: 1, joy: 3, owner: 0 }, want: 7 },
  ],
  brave: [
    { say: { en: "Something scary with you there: it comes to you", zh: "有你在时遇到可怕的事：它来找你" }, senses: { event: 3 }, want: 6 },
    { say: { en: "Even at night", zh: "夜里也一样" }, senses: { event: 3, time: 0 }, want: 6 },
    { say: { en: "Even before it trusts you", zh: "就算还不太信任你" }, senses: { event: 3 }, memory: { trust: 0 }, want: 6 },
  ],
  nap: [
    { say: { en: "Tired in the afternoon: it naps", zh: "下午累了：它会睡午觉" }, senses: { time: 2, energy: 1 }, want: 3 },
    { say: { en: "Worn out in the afternoon: it naps", zh: "下午累坏了：它会睡午觉" }, senses: { time: 2, energy: 0 }, want: 3 },
    { say: { en: "Tired in the morning: no nap yet", zh: "早上有点累：还不睡" }, senses: { time: 1, energy: 1 }, want: 3, not: true },
  ],
  greet: [
    { say: { en: "You come to see it: it gets excited to play", zh: "你来看它：它兴奋地想玩" }, senses: { owner: 1, joy: 2 }, want: 2 },
    { say: { en: "Even on a low day", zh: "心情低落时也一样" }, senses: { owner: 1, joy: 1 }, want: 2 },
    { say: { en: "Not when you're away", zh: "你不在时不会" }, senses: { owner: 0, joy: 2 }, want: 2, not: true },
  ],
  patient: [
    { say: { en: "A little peckish: it waits calmly", zh: "有点饿：它耐心等" }, senses: { hunger: 1 }, want: 0 },
    { say: { en: "Hungry but in high spirits with you: it still waits", zh: "饿了但和你玩得正开心：它还是等" }, senses: { hunger: 2, joy: 3 }, want: 0 },
    { say: { en: "Starving: it asks for food after all", zh: "饿坏了：还是会要吃的" }, senses: { hunger: 3 }, want: 0, not: true },
  ],
  tidy: [
    { say: { en: "Dusty: it asks for a bath", zh: "灰扑扑的：它要洗澡" }, senses: { clean: 1 }, want: 5 },
    { say: { en: "Filthy: it asks for a bath", zh: "脏兮兮的：它要洗澡" }, senses: { clean: 0 }, want: 5 },
    { say: { en: "Tidy: no fuss", zh: "干干净净：不闹" }, senses: { clean: 2 }, want: 5, not: true },
  ],
  explore: [
    { say: { en: "A fresh morning: off it goes exploring", zh: "精神好的早上：出去探险" }, senses: { time: 1, energy: 3 }, want: 4 },
    { say: { en: "A fine morning: still exploring", zh: "还不错的早上：也去探险" }, senses: { time: 1, energy: 2 }, want: 4 },
    { say: { en: "A fresh morning with a toy nearby: exploring still wins", zh: "精神好的早上旁边有玩具：还是先去探险" }, senses: { time: 1, energy: 3, event: 2 }, want: 4 },
  ],
  thanks: [
    { say: { en: "Fed when hungry: it comes for a cuddle", zh: "饿的时候被喂：它来撒娇" }, senses: { action: 1, hunger: 2 }, want: 6 },
    { say: { en: "Fed when full: still a cuddle", zh: "饱的时候被喂：也来撒娇" }, senses: { action: 1, hunger: 0 }, want: 6 },
    { say: { en: "Fed when starving: a cuddle first", zh: "饿坏了被喂：也先撒娇" }, senses: { action: 1, hunger: 3 }, want: 6 },
  ],
};

/** The program that decides a situation: the pet's single mind, or the half of a child that rules that time of day. */
function decidingProgram(spec: MindSpec, lessons: readonly Rule[], time: number): Program {
  if (!spec.family) return composeProgram(spec.line, lessons, spec.instincts, mindExtra(spec.growth));
  const [a, b] = halvesOf(spec.family, lessons, skillRules(spec.growth));
  return time === 1 || time === 2 ? a : b;
}

function memoryFor(p: Program, set: Record<string, number> = {}): number[] {
  const bits = new Array(stateBits(p)).fill(0);
  let at = 0;
  for (const m of p.memory) {
    const n = m.kind === "flag" ? 1 : m.bits;
    const v = set[m.name] ?? 0;
    for (let b = 0; b < n; b++) bits[at + b] = (v >> b) & 1;
    at += n;
  }
  return bits;
}

/** How a goal turns out on this mind: met or not, and which rule answered. */
export function checkGoal(spec: MindSpec, lessons: readonly Rule[], g: Goal): { met: boolean; rule: number; program: Program } {
  const senses = { ...CALM, ...g.senses };
  const p = decidingProgram(spec, lessons, senses.time);
  const r = runBeat(p, memoryFor(p, g.memory), encodeSenses(senses));
  const want = r.out & 7;
  return { met: g.not ? want !== g.want : want === g.want, rule: r.rule, program: p };
}

export interface LevelResult {
  id: string;
  learned: boolean;
  stars: number;
  goals: Array<{ goal: Goal; met: boolean; blockedBy?: Rule }>;
}

/** Every Pet School level as this pet stands now. */
export function schoolReport(spec: MindSpec): LevelResult[] {
  return PET_SCHOOL.map((l) => {
    const learned = spec.lessons.some((x) => sameRule(x, l.rule));
    const lessons = learned ? spec.lessons : [l.rule, ...spec.lessons];
    const goals = SCHOOL_GOALS[l.id]!.map((goal) => {
      const r = checkGoal(spec, lessons, goal);
      const fired = r.rule >= 0 ? r.program.rules[r.rule] : undefined;
      // a goal missed because another taught lesson answered first is a trap order
      const blockedBy = !r.met && fired && !sameRule(fired, l.rule) && spec.lessons.some((x) => sameRule(x, fired)) ? fired : undefined;
      return { goal, met: r.met, ...(blockedBy ? { blockedBy } : {}) };
    });
    return { id: l.id, learned, stars: learned ? goals.filter((g) => g.met).length : 0, goals };
  });
}

const sameRule = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

/** A level opens once the one before it has been learned (level 1 is always open). */
export function levelOpen(report: readonly LevelResult[], index: number): boolean {
  return index === 0 || report[index - 1]!.learned;
}

export interface Trap {
  /** the school lesson that loses a star */
  victim: string;
  goal: Goal;
  /** the lesson that answers first in that situation */
  blocker: Rule;
}

/** Stars a learned lesson has lost to a lesson above it. */
export function trapsOf(spec: MindSpec): Trap[] {
  return schoolReport(spec).flatMap((lv) => (lv.learned ? lv.goals.filter((g) => g.blockedBy).map((g) => ({ victim: lv.id, goal: g.goal, blocker: g.blockedBy! })) : []));
}

/** What would happen to the stars if a lesson moved: the traps the new order creates. */
export function trapsAfter(spec: MindSpec, lessons: readonly Rule[]): Trap[] {
  const before = new Set(trapsOf(spec).map((t) => `${t.victim}:${t.goal.say.en}`));
  return trapsOf({ ...spec, lessons }).filter((t) => !before.has(`${t.victim}:${t.goal.say.en}`));
}
