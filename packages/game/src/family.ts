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

import { type FastBrain, type Program, type Rule, type StarterLine, REF, circuitBrain, circuitFromParts, compileProgram, composeChild, composeInstinct, fastBrain, gateCount, inputField, stateBits } from "@lingxi/brain";
import { LESSON_CAPACITY, type MindExtra, cleanInstincts, composeProgram } from "./lessons";
import { type Growth, MAX_GATES_SKILLED, extraLessons, gateBudget, legalGrowth, ruleGrowth, ruleSkillIds, skillRules } from "./skills";
import { shownName } from "./names";
import type { Family, OutsideInstinct, ParentInfo, Stage } from "./pet";
import type { Brain } from "./sim";

export const BREED_COOLDOWN_DAYS = 3;
const TIME = inputField("time");

/** Each half of a child's mind: what the child was taught, then that parent's lessons and instincts. */
export function halvesOf(family: Family, childLessons: readonly Rule[], skillRulesOfChild: readonly Rule[] = []): [Program, Program] {
  const [a, b] = family.parents;
  // each half is its parent's own brain (its capstone rules too, since the child's circuit REFs that brain);
  // the child's own skill rules join both halves after them
  const extra = (p: ParentInfo): MindExtra => {
    const own = skillRules(ruleGrowth(p.skills ?? []));
    return { rules: [...own, ...skillRulesOfChild.filter((r) => !own.includes(r))] };
  };
  return [composeProgram(a.line, [...childLessons, ...a.lessons], a.instincts, extra(a)), composeProgram(b.line, [...childLessons, ...b.lessons], b.instincts, extra(b))];
}

/**
 * How many gates a newborn has to learn with: the smaller of its two halves' room under their budgets. Its halves start
 * as its parents' whole minds, so a child of a well-taught parent has none (0 or less) until it grows (A27).
 */
export function childRoom(family: Family): number {
  const halves = halvesOf(family, []);
  const budgets = halfBudgets(family, undefined);
  return Math.min(...halves.map((h, i) => budgets[i]! - gateCount(compileProgram(h))));
}

/**
 * How big each half of a child's mind may grow: the child's own budget, plus exactly the gates its parent's
 * capstone rules add (inherited rules never eat into what the child can learn), never past the most any brain holds.
 */
export function halfBudgets(family: Family, childGrowth: Growth | undefined): [number, number] {
  const own = gateBudget(childGrowth);
  const bare: Family = { ...family, parents: family.parents.map(({ skills: _s, ...p }) => p) as [ParentInfo, ParentInfo] };
  const withRules = halvesOf(family, []);
  const without = halvesOf(bare, []);
  return [0, 1].map((i) => Math.min(MAX_GATES_SKILLED, own + Math.max(0, gateCount(compileProgram(withRules[i]!)) - gateCount(compileProgram(without[i]!))))) as [number, number];
}

/** Only real rule skills, once each, in the order the skill table lists them. */
export const cleanParentSkills = (ids: unknown): number[] =>
  Array.isArray(ids) ? ruleSkillIds(ruleGrowth(ids.filter((x): x is number => Number.isInteger(x)))) : [];

/** What a pet's skills add to its mind: the capstone rules it holds. */
export const mindExtra = (growth: Growth | undefined): MindExtra => ({ rules: skillRules(growth) });

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

/** The gates an instinct runs each beat, from its built parts (nothing is compiled or run); null when it cannot be built as a 16-in, 8-out circuit. */
export function instinctGates(o: Pick<OutsideInstinct, "parts">): number | null {
  try {
    const c = circuitFromParts(o.parts);
    return c.nIn === 16 && c.nOut === 8 ? c.nGates : null;
  } catch {
    return null;
  }
}

/** An instinct circuit, rebuilt from its kept bytes; null when the bytes do not make a 16-in, 8-out circuit, or one too big to run (A38). */
export function instinctBrain(o: OutsideInstinct): { fast: FastBrain; nState: number; gates: number } | null {
  try {
    const c = circuitFromParts(o.parts);
    if (c.nIn !== 16 || c.nOut !== 8) return null;
    // counted before anything is compiled or run: a few kilobytes of REFs can expand to millions of gates
    if (c.nGates > INSTINCT_MAX_GATES) return null;
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
  /** levels and skills (plan 4.4): capstone rules, gate budget, memory, lesson slots */
  growth?: Growth;
  /** lesson slots a quest gave the player's pets (quest 65), on top of the stage and the skills */
  slots?: number;
}

/** The compiled brain for any pet, single or born of two parents. */
export function mindBrain(spec: MindSpec): Brain {
  const key = JSON.stringify([spec.line, spec.lessons, spec.family ?? null, spec.family ? 0 : (spec.instincts ?? 0), spec.outside ? `${spec.outside.processor}:${spec.outside.id}` : null, ruleSkillIds(spec.growth)]);
  const hit = cache.get(key);
  if (hit) return hit;
  let brain: Brain;
  if (spec.family) {
    const [pa, pb] = halvesOf(spec.family, spec.lessons, skillRules(spec.growth));
    const nA = stateBits(pa);
    brain = { fast: childFast(fastBrain(compileProgram(pa)), nA, fastBrain(compileProgram(pb))), nState: nA + stateBits(pb), halves: [pa, pb] };
  } else {
    const p = composeProgram(spec.line, spec.lessons, spec.instincts, mindExtra(spec.growth));
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

/** The most lesson slots a quest can give (quest 65's reward). */
export const QUEST_SLOTS_MAX = 1;

/** How many lessons a pet can hold: its stage's slots, those its skills add, and any a quest gave. */
export function lessonCapacity(stage: Exclude<Stage, "egg">, growth?: Growth, slots = 0): number {
  return LESSON_CAPACITY[stage] + extraLessons(growth) + Math.min(QUEST_SLOTS_MAX, Math.max(0, Math.floor(slots) || 0));
}

/** Whether a lesson fits this pet's mind; for a child, both halves must fit. */
export function checkMindLesson(spec: MindSpec, stage: Exclude<Stage, "egg">, candidate: Rule): MindCheck {
  const capacity = lessonCapacity(stage, spec.growth, spec.slots);
  if (spec.lessons.length >= capacity) return { ok: false, reason: "full", detail: `a ${stage} can hold ${capacity} lessons` };
  if (spec.lessons.some((l) => sameRule(l, candidate))) return { ok: false, reason: "duplicate", detail: "already learned" };
  const lessons = [candidate, ...spec.lessons];
  let programs: Program[];
  try {
    programs = spec.family ? halvesOf(spec.family, lessons, skillRules(spec.growth)) : [composeProgram(spec.line, lessons, spec.instincts, mindExtra(spec.growth))];
  } catch (e) {
    return { ok: false, reason: "invalid", detail: (e as Error).message };
  }
  const sizes = programs.map((p) => gateCount(compileProgram(p)));
  const budgets = spec.family ? halfBudgets(spec.family, spec.growth) : [gateBudget(spec.growth)];
  const over = sizes.findIndex((g, i) => g > budgets[i]!);
  const gates = Math.max(...sizes);
  if (over >= 0) return { ok: false, reason: "tooBig", detail: `${sizes[over]} gates; the limit is ${budgets[over]}` };
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

/**
 * A child's family record from its two parents (A first: A shapes its days and moods, B its nights and habits). Each
 * parent passes on its whole mind as it is now: every lesson, its instincts and its capstone skills, since the child's
 * circuit on chain is made of the parents' own circuits (A27; it once kept only the first 8 lessons, so the game's copy
 * of a child of a well-taught parent differed from the chain's).
 */
export function familyOf(a: ParentInfo & { generation?: number }, b: ParentInfo & { generation?: number }): Family {
  if ((a.generation ?? 0) > 0 || (b.generation ?? 0) > 0) throw new Error("secondGeneration");
  for (const p of [a, b]) if (p.lessons.length > MAX_LESSONS) throw new Error("a parent holds more lessons than any pet can");
  const strip = ({ name, line, lessons, instincts, petId, owner, key, skills }: ParentInfo): ParentInfo => ({
    name: shownName(name, 12),
    line,
    lessons: [...lessons],
    ...(cleanInstincts(instincts) ? { instincts: cleanInstincts(instincts) } : {}),
    ...(cleanParentSkills(skills).length ? { skills: cleanParentSkills(skills) } : {}),
    ...(petId !== undefined ? { petId } : {}),
    ...(owner ? { owner } : {}),
    ...(key ? { key } : {}),
  });
  const family: Family = { parents: [strip(a), strip(b)], generation: 1 };
  // each half is a parent's own brain, so it may be as big as any pet brain can be (a parent's skills widen it)
  const [pa, pb] = halvesOf(family, []);
  for (const p of [pa, pb]) if (gateCount(compileProgram(p)) > MAX_GATES_SKILLED) throw new Error("a parent's mind is too big to pass on");
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
  /** its level and skills (plan 4.4); a card's growth must be one the rules could have produced */
  growth?: Growth;
}

const LINES = ["gentle", "bold", "curious"] as const;
/** The most lessons any pet can hold: an elder's eight, five from skills (three capstone, two from ranks) and one from quest 65. */
export const MAX_LESSONS = 14;

/** Read a growth from someone else's card: dropped unless the rules could have produced it. */
export function cleanGrowth(v: unknown): Growth | undefined {
  const g = v as Partial<Growth> | undefined;
  if (!g || typeof g !== "object" || !g.skills || typeof g.skills !== "object" || Array.isArray(g.skills)) return undefined;
  const skills: Record<number, number> = {};
  for (const [k, n] of Object.entries(g.skills as Record<string, unknown>)) if (Number.isInteger(n) && (n as number) > 0) skills[Number(k)] = n as number;
  const out = { level: g.level as number, points: g.points as number, skills };
  return legalGrowth(out) ? out : undefined;
}

export function petCard(p: { lessons: readonly Rule[]; family?: Family; brain?: readonly number[]; instincts?: number; outside?: OutsideInstinct; growth?: Growth }): string {
  return JSON.stringify({
    lessons: p.lessons,
    ...(p.growth && Object.keys(p.growth.skills).length ? { growth: p.growth } : {}),
    ...(p.instincts ? { instincts: p.instincts } : {}),
    ...(p.family ? { family: p.family } : {}),
    ...(p.brain ? { memory: p.brain.map((b) => (b ? 1 : 0)) } : {}),
    ...(p.outside ? { outside: { processor: p.outside.processor, id: p.outside.id, owner: p.outside.owner, parts: p.outside.parts } } : {}),
  });
}

/**
 * The card budget (A26), the one every road a card travels is sized to: the pet itself (lessons, skills, family,
 * memory: the fullest a player can raise measures 4,082 characters) and an owned instinct's circuits.
 */
export const CARD_BASE_MAX = 10_000;
/** The most a card's instinct bytes may weigh (hex characters). */
export const CARD_OUTSIDE_MAX = 24_000;
/** The longest card the game reads, and so the longest any route must carry. */
export const CARD_MAX = CARD_BASE_MAX + CARD_OUTSIDE_MAX;

/**
 * A38: the most gates an instinct may run each beat, counted as it runs them (every REF counts its target again):
 * as many as the largest instinct a card can carry with no REF at all (a LATCH, the smallest element, is 4 bytes).
 * REFs may make an instinct smaller to carry, never bigger to run.
 */
export const INSTINCT_MAX_GATES = CARD_OUTSIDE_MAX / 2 / 4;

/** The gates of a glue circuit, apart from what it REFs. */
const glueGates = (c: { elements: ReadonlyArray<{ op: number }> }) => c.elements.filter((e) => e.op !== REF).length;
const SOMEWHERE = { cpu: `0x${"0".repeat(40)}`, id: 1n };

/**
 * The most gates an honest pet's whole mind runs each beat: a child's two halves at the skilled budget, an instinct at
 * its budget, and the glue around them (`composeChild`, `composeInstinct`). No brain from someone else, on a card or on
 * chain, is run past it.
 */
export const MAX_RUN_GATES = 2 * MAX_GATES_SKILLED + INSTINCT_MAX_GATES + glueGates(composeChild(SOMEWHERE, SOMEWHERE)) + glueGates(composeInstinct(SOMEWHERE, SOMEWHERE));

/** Whether an instinct's circuits fit a card: a pet never learns one its card could not carry to friends (A26). */
export const instinctFits = (parts: ReadonlyArray<{ hex: string }>): boolean => parts.reduce((n, p) => n + p.hex.length, 0) <= CARD_OUTSIDE_MAX;

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
  if (typeof raw !== "string" || raw.length > CARD_MAX) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    const lessons = (Array.isArray(v) ? v : (v as { lessons?: unknown }).lessons) as unknown;
    if (!Array.isArray(lessons) || lessons.length > MAX_LESSONS) return null;
    const growth = Array.isArray(v) ? undefined : cleanGrowth((v as { growth?: unknown }).growth);
    const rawMem = Array.isArray(v) ? undefined : (v as { memory?: unknown }).memory;
    const memory = Array.isArray(rawMem) && rawMem.length <= 64 && rawMem.every((x) => x === 0 || x === 1) ? (rawMem as number[]) : undefined;
    const instincts = Array.isArray(v) ? 0 : cleanInstincts((v as { instincts?: unknown }).instincts);
    const fam = Array.isArray(v) ? undefined : (v as { family?: unknown }).family;
    const outside = Array.isArray(v) ? undefined : cleanOutside((v as { outside?: unknown }).outside);
    if (!Array.isArray(v) && (v as { outside?: unknown }).outside !== undefined && !outside) return null;
    if (fam === undefined) return { lessons: lessons as Rule[], ...(instincts ? { instincts } : {}), ...(memory ? { memory } : {}), ...(outside ? { outside } : {}), ...(growth ? { growth } : {}) };
    const f = fam as { parents?: unknown; generation?: unknown };
    if (!Array.isArray(f.parents) || f.parents.length !== 2) return null;
    if (!Number.isInteger(f.generation) || (f.generation as number) < 1 || (f.generation as number) > 99) return null;
    const parents = (f.parents as Array<Record<string, unknown>>).map((p) => {
      const line = LINES.find((l) => l === p.line);
      if (!line || typeof p.name !== "string" || !Array.isArray(p.lessons) || p.lessons.length > MAX_LESSONS) throw new Error("bad parent");
      const pi = cleanInstincts(p.instincts);
      const ps = cleanParentSkills(p.skills);
      return { name: shownName(p.name, 12), line, lessons: p.lessons as Rule[], ...(pi ? { instincts: pi } : {}), ...(ps.length ? { skills: ps } : {}) };
    }) as [ParentInfo, ParentInfo];
    return { lessons: lessons as Rule[], family: { parents, generation: f.generation as number }, ...(memory ? { memory } : {}), ...(outside ? { outside } : {}), ...(growth ? { growth } : {}) };
  } catch {
    return null;
  }
}
