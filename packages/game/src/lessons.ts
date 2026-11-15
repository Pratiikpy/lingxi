/**
 * Teaching. A lesson is one rule the owner adds to the pet's mind. Lessons sit
 * above the starter instincts in priority (what you teach outranks what it was
 * born with), in the order the owner arranges them.
 *
 * Every lesson is checked the same way, whether it came from the block editor,
 * Pet School or plain words: the rule must use only known pins and memory, the
 * whole program must validate, and the compiled circuit must fit the brain's
 * size budget. Nothing reaches the pet until it passes.
 */

import {
  type Program,
  type Rule,
  STARTERS,
  type StarterLine,
  compileProgram,
  gateCount,
  validateProgram,
} from "@lingxi/brain";
import { type Stage, stageOf } from "./pet";
import type { Pet } from "./sim";

/** The most gates a pet brain may compile to (TapeOut cost and on-chain step gas). */
export const MAX_GATES = 500;

/** How many lessons a pet can hold at each stage; capacity grows as it grows. */
export const LESSON_CAPACITY: Record<Exclude<Stage, "egg">, number> = { baby: 1, child: 2, teen: 4, adult: 6, elder: 8 };

export function composeProgram(line: StarterLine, lessons: readonly Rule[]): Program {
  const base = STARTERS[line];
  return validateProgram({ ...base, rules: [...lessons, ...base.rules] });
}

export type LessonCheck =
  | { ok: true; program: Program; gates: number }
  | { ok: false; reason: "invalid" | "full" | "tooBig" | "duplicate"; detail: string };

const sameRule = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

export function checkLesson(line: StarterLine, stage: Exclude<Stage, "egg">, lessons: readonly Rule[], candidate: Rule): LessonCheck {
  if (lessons.length >= LESSON_CAPACITY[stage]) {
    return { ok: false, reason: "full", detail: `a ${stage} can hold ${LESSON_CAPACITY[stage]} lessons` };
  }
  if (lessons.some((l) => sameRule(l, candidate))) return { ok: false, reason: "duplicate", detail: "already learned" };
  let program: Program;
  try {
    program = composeProgram(line, [candidate, ...lessons]);
  } catch (e) {
    return { ok: false, reason: "invalid", detail: (e as Error).message };
  }
  const gates = gateCount(compileProgram(program));
  if (gates > MAX_GATES) return { ok: false, reason: "tooBig", detail: `${gates} gates; the limit is ${MAX_GATES}` };
  return { ok: true, program, gates };
}

/* ── Pet School: lessons that need no AI and work fully offline ──────────── */

export interface SchoolLesson {
  id: string;
  say: { en: string; zh: string };
  rule: Rule;
}

export const PET_SCHOOL: readonly SchoolLesson[] = [
  {
    id: "share",
    say: { en: "Share your toys with friends", zh: "有玩具要和朋友分享" },
    rule: { label: "shares toys with friends", when: { event: [1], joy: [1, 2, 3] }, then: { want: 7, mood: 2, nudge: 6 } },
  },
  {
    id: "brave",
    say: { en: "Be brave when something scary happens and I'm here", zh: "我在的时候，遇到可怕的事要勇敢" },
    rule: { label: "brave with you near", when: { event: [3], owner: [1] }, then: { want: 6, mood: 1, nudge: 1 } },
  },
  {
    id: "nap",
    say: { en: "Take a nap in the afternoon when you're tired", zh: "白天累了就睡个午觉" },
    rule: { label: "afternoon nap", when: { time: [2], energy: [0, 1] }, then: { want: 3, mood: 1, nudge: 4 } },
  },
  {
    id: "greet",
    say: { en: "Get excited when I come to see you", zh: "看到我来就开心起来" },
    rule: { label: "happy to see you", when: { owner: [1], action: [0], joy: [1, 2, 3] }, then: { want: 2, mood: 3, nudge: 5 } },
  },
  {
    id: "patient",
    say: { en: "Wait calmly for food when you're only a little hungry", zh: "只是有点饿的时候，要耐心等饭" },
    rule: { label: "waits calmly", when: { hunger: [1, 2], action: [0] }, then: { want: 0, mood: 1, nudge: 4 } },
  },
  {
    id: "tidy",
    say: { en: "Ask for a bath when you get dusty", zh: "身上脏了就要洗澡" },
    rule: { label: "asks for a bath", when: { clean: [0, 1] }, then: { want: 5, mood: 1 } },
  },
  {
    id: "explore",
    say: { en: "Go exploring in the morning when you're rested", zh: "早上精神好就出去探险" },
    rule: { label: "morning explorer", when: { time: [1], energy: [2, 3] }, then: { want: 4, mood: 2, nudge: 2 } },
  },
  {
    id: "thanks",
    say: { en: "Cuddle me after I feed you", zh: "我喂你以后，过来撒个娇" },
    rule: { label: "thanks for food", when: { action: [1] }, then: { want: 6, mood: 2, nudge: 6 } },
  },
];

/** Teach the pet a rule. Returns the new pet, or why the lesson was refused. */
export function teach(p: Pet, rule: Rule, now: number): { ok: true; pet: Pet; gates: number } | Extract<LessonCheck, { ok: false }> {
  const stage = stageOf(p, now);
  const r = checkLesson(p.line, stage, p.lessons, rule);
  if (!r.ok) return r;
  return {
    ok: true,
    gates: r.gates,
    pet: { ...p, lessons: [rule, ...p.lessons], counts: { ...p.counts, lessons: Math.min(255, p.counts.lessons + 1) } },
  };
}

/** Move a lesson up or down in priority, or forget it. */
export function arrangeLessons(p: Pet, index: number, move: "up" | "down" | "forget"): Pet {
  const ls = p.lessons.slice();
  if (index < 0 || index >= ls.length) return p;
  if (move === "forget") ls.splice(index, 1);
  else {
    const j = move === "up" ? index - 1 : index + 1;
    if (j < 0 || j >= ls.length) return p;
    [ls[index], ls[j]] = [ls[j]!, ls[index]!];
  }
  return { ...p, lessons: ls };
}
