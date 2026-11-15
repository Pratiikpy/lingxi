/**
 * Families (LX-CHILD/1 in the game). A child's mind is its two parents' minds
 * wired side by side, exactly as the on-chain child circuit REFs both parent
 * circuits (see @lingxi/brain compose.ts):
 *   want   from parent A in the morning and day, from parent B in the evening and night
 *   mood   always from parent A
 *   nudge  always from parent B
 * and its memory is parent A's memory followed by parent B's.
 *
 * What a child is taught goes into both halves (ahead of each parent's own
 * lessons), so teaching shapes it by day and by night alike; each half must
 * still fit the brain's size budget.
 */

import { type FastBrain, type Program, type Rule, type StarterLine, compileProgram, fastBrain, gateCount, inputField, stateBits } from "@lingxi/brain";
import { LESSON_CAPACITY, MAX_GATES, composeProgram } from "./lessons";
import type { Family, ParentInfo, Stage } from "./pet";
import type { Brain } from "./sim";

export const BREED_COOLDOWN_DAYS = 3;
const TIME = inputField("time");

/** Each half of a child's mind: what the child was taught, then that parent's lessons and instincts. */
export function halvesOf(family: Family, childLessons: readonly Rule[]): [Program, Program] {
  const [a, b] = family.parents;
  return [composeProgram(a.line, [...childLessons, ...a.lessons]), composeProgram(b.line, [...childLessons, ...b.lessons])];
}

/** The child's fast brain: both halves on the same senses, mixed the way the child circuit mixes them. */
export function childFast(a: FastBrain, nA: number, b: FastBrain): FastBrain {
  return {
    step(state: Uint8Array, word: number): number {
      const oa = a.step(state.subarray(0, nA), word);
      const ob = b.step(state.subarray(nA), word);
      const time = (word >> TIME.lo) & 3;
      const want = time === 1 || time === 2 ? oa & 7 : ob & 7;
      return want | (oa & 0b11000) | (ob & 0b11100000);
    },
  } as FastBrain;
}

const cache = new Map<string, Brain>();

export interface MindSpec {
  line: StarterLine;
  lessons: readonly Rule[];
  family?: Family;
}

/** The compiled brain for any pet, single or born of two parents. */
export function mindBrain(spec: MindSpec): Brain {
  const key = JSON.stringify([spec.line, spec.lessons, spec.family ?? null]);
  const hit = cache.get(key);
  if (hit) return hit;
  let brain: Brain;
  if (spec.family) {
    const [pa, pb] = halvesOf(spec.family, spec.lessons);
    const nA = stateBits(pa);
    brain = { fast: childFast(fastBrain(compileProgram(pa)), nA, fastBrain(compileProgram(pb))), nState: nA + stateBits(pb), halves: [pa, pb] };
  } else {
    const p = spec.lessons.length ? composeProgram(spec.line, spec.lessons) : composeProgram(spec.line, []);
    brain = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, brain);
  return brain;
}

export type MindCheck =
  | { ok: true; gates: number }
  | { ok: false; reason: "invalid" | "full" | "tooBig" | "duplicate"; detail: string };

const sameRule = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

/** Whether a lesson fits this pet's mind; for a child, both halves must fit. */
export function checkMindLesson(spec: MindSpec, stage: Exclude<Stage, "egg">, candidate: Rule): MindCheck {
  if (spec.lessons.length >= LESSON_CAPACITY[stage]) return { ok: false, reason: "full", detail: `a ${stage} can hold ${LESSON_CAPACITY[stage]} lessons` };
  if (spec.lessons.some((l) => sameRule(l, candidate))) return { ok: false, reason: "duplicate", detail: "already learned" };
  const lessons = [candidate, ...spec.lessons];
  let programs: Program[];
  try {
    programs = spec.family ? halvesOf(spec.family, lessons) : [composeProgram(spec.line, lessons)];
  } catch (e) {
    return { ok: false, reason: "invalid", detail: (e as Error).message };
  }
  const gates = Math.max(...programs.map((p) => gateCount(compileProgram(p))));
  if (gates > MAX_GATES) return { ok: false, reason: "tooBig", detail: `${gates} gates; the limit is ${MAX_GATES}` };
  return { ok: true, gates };
}

/** Whether two parents can have a child: both grown, different pets, rested since last time, minds that fit. */
export function canBreed(a: { stage: Exclude<Stage, "egg">; lastBredDay?: number }, b: { stage: Exclude<Stage, "egg">; lastBredDay?: number }, today: number): { ok: true } | { ok: false; reason: "notAdult" | "tooSoon" } {
  const grown = (s: string) => s === "adult" || s === "elder";
  if (!grown(a.stage) || !grown(b.stage)) return { ok: false, reason: "notAdult" };
  for (const p of [a, b]) if (p.lastBredDay !== undefined && today - p.lastBredDay < BREED_COOLDOWN_DAYS) return { ok: false, reason: "tooSoon" };
  return { ok: true };
}

/** A child's family record from its two parents (A first: A shapes its days and moods, B its nights and habits). */
export function familyOf(a: ParentInfo & { generation?: number }, b: ParentInfo & { generation?: number }): Family {
  const strip = ({ name, line, lessons, petId, owner, key }: ParentInfo): ParentInfo => ({
    name: name.slice(0, 12),
    line,
    lessons: lessons.slice(0, 8),
    ...(petId !== undefined ? { petId } : {}),
    ...(owner ? { owner } : {}),
    ...(key ? { key } : {}),
  });
  const family: Family = { parents: [strip(a), strip(b)], generation: Math.max(a.generation ?? 0, b.generation ?? 0) + 1 };
  // both halves must build and fit, or there is no child
  const [pa, pb] = halvesOf(family, []);
  for (const p of [pa, pb]) if (gateCount(compileProgram(p)) > MAX_GATES) throw new Error("a parent's mind is too big to pass on");
  return family;
}

/* ── pet cards: what a pet shares in a live room so friends can spar or start a family ── */

export interface PetCard {
  lessons: Rule[];
  family?: Family;
}

const LINES = ["gentle", "bold", "curious"] as const;

export function petCard(p: { lessons: readonly Rule[]; family?: Family }): string {
  return JSON.stringify({ lessons: p.lessons, ...(p.family ? { family: p.family } : {}) });
}

/** Reads a card from someone else. Everything is checked; anything odd means no card. */
export function parseCard(raw: string): PetCard | null {
  if (typeof raw !== "string" || raw.length > 10_000) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    const lessons = (Array.isArray(v) ? v : (v as { lessons?: unknown }).lessons) as unknown;
    if (!Array.isArray(lessons) || lessons.length > 8) return null;
    const fam = Array.isArray(v) ? undefined : (v as { family?: unknown }).family;
    if (fam === undefined) return { lessons: lessons as Rule[] };
    const f = fam as { parents?: unknown; generation?: unknown };
    if (!Array.isArray(f.parents) || f.parents.length !== 2) return null;
    if (!Number.isInteger(f.generation) || (f.generation as number) < 1 || (f.generation as number) > 99) return null;
    const parents = (f.parents as Array<Record<string, unknown>>).map((p) => {
      const line = LINES.find((l) => l === p.line);
      if (!line || typeof p.name !== "string" || !Array.isArray(p.lessons) || p.lessons.length > 8) throw new Error("bad parent");
      return { name: p.name.slice(0, 12), line, lessons: p.lessons as Rule[] };
    }) as [ParentInfo, ParentInfo];
    return { lessons: lessons as Rule[], family: { parents, generation: f.generation as number } };
  } catch {
    return null;
  }
}
