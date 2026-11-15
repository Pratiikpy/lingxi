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

import { type FastBrain, type Program, type Rule, type StarterLine, circuitBrain, circuitFromParts, compileProgram, fastBrain, gateCount, inputField, stateBits } from "@lingxi/brain";
import { LESSON_CAPACITY, MAX_GATES, cleanInstincts, composeProgram } from "./lessons";
import type { Family, OutsideInstinct, ParentInfo, Stage } from "./pet";
import type { Brain } from "./sim";

export const BREED_COOLDOWN_DAYS = 3;
const TIME = inputField("time");

/** Each half of a child's mind: what the child was taught, then that parent's lessons and instincts. */
export function halvesOf(family: Family, childLessons: readonly Rule[]): [Program, Program] {
  const [a, b] = family.parents;
  return [composeProgram(a.line, [...childLessons, ...a.lessons], a.instincts), composeProgram(b.line, [...childLessons, ...b.lessons], b.instincts)];
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

/**
 * A mind with an owned instinct: both read the same senses, the pet's own memory
 * first and the instinct's after it, and the instinct answers whenever it wants
 * anything but idle, exactly as the LX-INSTINCT/1 circuit mixes them on chain.
 */
export function instinctFast(own: FastBrain, nOwn: number, instinct: FastBrain): FastBrain {
  return {
    step(state: Uint8Array, word: number): number {
      const oo = own.step(state.subarray(0, nOwn), word);
      const oi = instinct.step(state.subarray(nOwn), word);
      return oi & 7 ? oi : oo;
    },
  } as FastBrain;
}

/** The most memory a pet's brain may hold (the registry keeps 64 bits). */
export const MAX_MIND_STATE = 64;

/** An instinct circuit, rebuilt from its kept bytes; null when the bytes do not make a 16-in, 8-out circuit. */
export function instinctBrain(o: OutsideInstinct): { fast: FastBrain; nState: number; gates: number } | null {
  try {
    const c = circuitFromParts(o.parts);
    if (c.nIn !== 16 || c.nOut !== 8) return null;
    return { fast: circuitBrain(c), nState: c.nState, gates: c.nGates };
  } catch {
    return null;
  }
}

const cache = new Map<string, Brain>();

export interface MindSpec {
  line: StarterLine;
  lessons: readonly Rule[];
  family?: Family;
  /** the four instinct switches (a child's instincts come from its parents' halves) */
  instincts?: number;
  /** an owned circuit taught as an everyday instinct */
  outside?: OutsideInstinct;
}

/** The compiled brain for any pet, single or born of two parents. */
export function mindBrain(spec: MindSpec): Brain {
  const key = JSON.stringify([spec.line, spec.lessons, spec.family ?? null, spec.family ? 0 : (spec.instincts ?? 0), spec.outside ? `${spec.outside.processor}:${spec.outside.id}` : null]);
  const hit = cache.get(key);
  if (hit) return hit;
  let brain: Brain;
  if (spec.family) {
    const [pa, pb] = halvesOf(spec.family, spec.lessons);
    const nA = stateBits(pa);
    brain = { fast: childFast(fastBrain(compileProgram(pa)), nA, fastBrain(compileProgram(pb))), nState: nA + stateBits(pb), halves: [pa, pb] };
  } else {
    const p = composeProgram(spec.line, spec.lessons, spec.instincts);
    brain = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
  }
  const inst = spec.outside ? instinctBrain(spec.outside) : null;
  if (inst) brain = { ...brain, fast: instinctFast(brain.fast, brain.nState, inst.fast), nState: brain.nState + inst.nState, instinct: { fast: inst.fast, from: brain.nState } };
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
    programs = spec.family ? halvesOf(spec.family, lessons) : [composeProgram(spec.line, lessons, spec.instincts)];
  } catch (e) {
    return { ok: false, reason: "invalid", detail: (e as Error).message };
  }
  const gates = Math.max(...programs.map((p) => gateCount(compileProgram(p))));
  if (gates > MAX_GATES) return { ok: false, reason: "tooBig", detail: `${gates} gates; the limit is ${MAX_GATES}` };
  // an owned instinct keeps its own memory beside the pet's; together they must fit the registry's 64 bits
  if (spec.outside) {
    const memory = programs.reduce((t, p) => t + stateBits(p), 0) + (instinctBrain(spec.outside)?.nState ?? 0);
    if (memory > MAX_MIND_STATE) return { ok: false, reason: "tooBig", detail: `${memory} memory bits with its instinct; the limit is ${MAX_MIND_STATE}` };
  }
  return { ok: true, gates };
}

interface BreedSide {
  stage: Exclude<Stage, "egg">;
  lastBredDay?: number;
  /** 0 for a hatched pet; a pet born of two parents cannot have children (see Breeder.NotFirstGeneration) */
  generation?: number;
}

/**
 * Whether two parents can have a child: both hatched from eggs (a child's mind is
 * already two minds, and composing it again would silence its inner ancestors),
 * both grown, and rested since last time.
 */
export function canBreed(a: BreedSide, b: BreedSide, today: number): { ok: true } | { ok: false; reason: "notAdult" | "tooSoon" | "secondGeneration" } {
  if ((a.generation ?? 0) > 0 || (b.generation ?? 0) > 0) return { ok: false, reason: "secondGeneration" };
  const grown = (s: string) => s === "adult" || s === "elder";
  if (!grown(a.stage) || !grown(b.stage)) return { ok: false, reason: "notAdult" };
  for (const p of [a, b]) if (p.lastBredDay !== undefined && today - p.lastBredDay < BREED_COOLDOWN_DAYS) return { ok: false, reason: "tooSoon" };
  return { ok: true };
}

/** A child's family record from its two parents (A first: A shapes its days and moods, B its nights and habits). */
export function familyOf(a: ParentInfo & { generation?: number }, b: ParentInfo & { generation?: number }): Family {
  if ((a.generation ?? 0) > 0 || (b.generation ?? 0) > 0) throw new Error("secondGeneration");
  const strip = ({ name, line, lessons, instincts, petId, owner, key }: ParentInfo): ParentInfo => ({
    name: name.slice(0, 12),
    line,
    lessons: lessons.slice(0, 8),
    ...(cleanInstincts(instincts) ? { instincts: cleanInstincts(instincts) } : {}),
    ...(petId !== undefined ? { petId } : {}),
    ...(owner ? { owner } : {}),
    ...(key ? { key } : {}),
  });
  const family: Family = { parents: [strip(a), strip(b)], generation: 1 };
  // both halves must build and fit, or there is no child
  const [pa, pb] = halvesOf(family, []);
  for (const p of [pa, pb]) if (gateCount(compileProgram(p)) > MAX_GATES) throw new Error("a parent's mind is too big to pass on");
  return family;
}

/* ── pet cards: what a pet shares in a live room so friends can spar or start a family ── */

export interface PetCard {
  lessons: Rule[];
  instincts?: number;
  family?: Family;
  /** the pet's memory bits, which a child inherits */
  memory?: number[];
  /** an owned circuit it was taught as an everyday instinct */
  outside?: OutsideInstinct;
}

const LINES = ["gentle", "bold", "curious"] as const;

export function petCard(p: { lessons: readonly Rule[]; family?: Family; brain?: readonly number[]; instincts?: number; outside?: OutsideInstinct }): string {
  return JSON.stringify({
    lessons: p.lessons,
    ...(p.instincts ? { instincts: p.instincts } : {}),
    ...(p.family ? { family: p.family } : {}),
    ...(p.brain ? { memory: p.brain.map((b) => (b ? 1 : 0)) } : {}),
    ...(p.outside ? { outside: { processor: p.outside.processor, id: p.outside.id, owner: p.outside.owner, parts: p.outside.parts } } : {}),
  });
}

/** The most a card's instinct bytes may weigh (hex characters). */
export const CARD_OUTSIDE_MAX = 24_000;

/** An instinct from someone else's card: every field checked, and the bytes must rebuild into a pet-shaped circuit. */
export function cleanOutside(v: unknown): OutsideInstinct | undefined {
  const o = v as Partial<OutsideInstinct> | undefined;
  if (!o || typeof o !== "object") return undefined;
  const hexAddr = (x: unknown) => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);
  if (!hexAddr(o.processor) || typeof o.id !== "string" || !/^\d{1,20}$/.test(o.id) || !(o.owner === "" || hexAddr(o.owner)) || !Array.isArray(o.parts) || !o.parts.length || o.parts.length > 24) return undefined;
  let size = 0;
  for (const p of o.parts) {
    if (!p || !hexAddr(p.processor) || typeof p.id !== "string" || !/^\d{1,20}$/.test(p.id) || !Number.isInteger(p.nIn) || !Number.isInteger(p.nOut) || typeof p.hex !== "string" || !/^[0-9a-f]*$/.test(p.hex)) return undefined;
    size += p.hex.length;
  }
  if (size > CARD_OUTSIDE_MAX) return undefined;
  const clean: OutsideInstinct = { processor: o.processor!.toLowerCase(), id: o.id, owner: (o.owner ?? "").toLowerCase(), parts: o.parts.map((p) => ({ processor: p.processor.toLowerCase(), id: p.id, nIn: p.nIn, nOut: p.nOut, hex: p.hex })) };
  return instinctBrain(clean) ? clean : undefined;
}

/** A newborn's memory: parent A's memory, then parent B's (as the Breeder mixes it on chain). */
export function childMemory(nState: number, a: readonly number[], b: readonly number[] | undefined): number[] {
  const mixed = [...a, ...(b ?? [])].map((x) => (x ? 1 : 0));
  return mixed.length === nState ? mixed : new Array(nState).fill(0);
}

/** Reads a card from someone else. Everything is checked; anything odd means no card. */
export function parseCard(raw: string): PetCard | null {
  if (typeof raw !== "string" || raw.length > 10_000 + CARD_OUTSIDE_MAX) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    const lessons = (Array.isArray(v) ? v : (v as { lessons?: unknown }).lessons) as unknown;
    if (!Array.isArray(lessons) || lessons.length > 8) return null;
    const rawMem = Array.isArray(v) ? undefined : (v as { memory?: unknown }).memory;
    const memory = Array.isArray(rawMem) && rawMem.length <= 64 && rawMem.every((x) => x === 0 || x === 1) ? (rawMem as number[]) : undefined;
    const instincts = Array.isArray(v) ? 0 : cleanInstincts((v as { instincts?: unknown }).instincts);
    const fam = Array.isArray(v) ? undefined : (v as { family?: unknown }).family;
    const outside = Array.isArray(v) ? undefined : cleanOutside((v as { outside?: unknown }).outside);
    if (!Array.isArray(v) && (v as { outside?: unknown }).outside !== undefined && !outside) return null;
    if (fam === undefined) return { lessons: lessons as Rule[], ...(instincts ? { instincts } : {}), ...(memory ? { memory } : {}), ...(outside ? { outside } : {}) };
    const f = fam as { parents?: unknown; generation?: unknown };
    if (!Array.isArray(f.parents) || f.parents.length !== 2) return null;
    if (!Number.isInteger(f.generation) || (f.generation as number) < 1 || (f.generation as number) > 99) return null;
    const parents = (f.parents as Array<Record<string, unknown>>).map((p) => {
      const line = LINES.find((l) => l === p.line);
      if (!line || typeof p.name !== "string" || !Array.isArray(p.lessons) || p.lessons.length > 8) throw new Error("bad parent");
      const pi = cleanInstincts(p.instincts);
      return { name: p.name.slice(0, 12), line, lessons: p.lessons as Rule[], ...(pi ? { instincts: pi } : {}) };
    }) as [ParentInfo, ParentInfo];
    return { lessons: lessons as Rule[], family: { parents, generation: f.generation as number }, ...(memory ? { memory } : {}), ...(outside ? { outside } : {}) };
  } catch {
    return null;
  }
}
