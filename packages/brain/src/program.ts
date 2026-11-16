/**
 * A pet brain anyone can read: memory fields, then an ordered list of
 * "when ... then ..." rules. src/compile.ts turns a program into NAND and LATCH
 * gates in TapeOut's encoding; this file is the reference meaning of a program,
 * and the tests check the compiled circuit against it beat for beat.
 *
 * A condition names a field and the values it may hold. Fields are the input
 * pins (src/pins.ts) and the program's own memory. A clause holds when all its
 * conditions hold. Rules are read top to bottom and the first match decides; if
 * none matches, `otherwise` decides.
 *
 * Every rule and every memory update reads memory as it was at the start of the
 * beat (a LATCH outputs what it stored last beat), so the order of memory fields
 * never changes behaviour.
 *
 * Memory kinds:
 *   flag     1 bit. reset wins over set; otherwise it keeps its value.
 *   counter  1-4 bits, saturating. reset wins, then inc and dec (both at once cancel).
 *   timer    1-4 bits. Counts beats while `count` holds (every beat if absent),
 *            saturating at its maximum; reset wins.
 */

import { INPUT_FIELD_NAMES, type InputField, N_IN, decodeOutput, encodeOutput, inputField } from "./pins";

export const PROGRAM_VERSION = "LX-PET/1";
/** A guard on program size, not an on-chain limit (the gate budget is): room for a fully skilled elder of any line (16 starter rules, 4 instincts, 4 skill rules, 13 lessons: 37). */
export const MAX_RULES = 40;
export const MAX_MEMORY_BITS = 48;
export const MAX_MEMORY_FIELDS = 16;

export type Clause = Record<string, number[]>;

export interface Out {
  want: number;
  mood: number;
  nudge?: number;
}

export interface Rule {
  when: Clause;
  then: Out;
  label?: string;
}

interface MemoryBase {
  name: string;
  label?: string;
}
export interface FlagMemory extends MemoryBase {
  kind: "flag";
  set: Clause[];
  reset?: Clause[];
}
export interface CounterMemory extends MemoryBase {
  kind: "counter";
  bits: number;
  inc?: Clause[];
  dec?: Clause[];
  reset?: Clause[];
}
export interface TimerMemory extends MemoryBase {
  kind: "timer";
  bits: number;
  count?: Clause[];
  reset: Clause[];
}
export type Memory = FlagMemory | CounterMemory | TimerMemory;

export interface Program {
  version: typeof PROGRAM_VERSION;
  memory: Memory[];
  rules: Rule[];
  otherwise: Out;
}

export const memoryBits = (m: Memory): number => (m.kind === "flag" ? 1 : m.bits);

export interface FieldInfo {
  name: string;
  bits: number;
  /** "input" fields read pins starting at lo; "memory" fields read state bits starting at lo */
  source: "input" | "memory";
  lo: number;
}

/** Every field a program can read, with where its bits live. */
export function fieldTable(p: Pick<Program, "memory">): Map<string, FieldInfo> {
  const t = new Map<string, FieldInfo>();
  for (const name of INPUT_FIELD_NAMES) {
    const f = inputField(name);
    t.set(name, { name, bits: f.bits, source: "input", lo: f.lo });
  }
  let lo = 0;
  for (const m of p.memory) {
    t.set(m.name, { name: m.name, bits: memoryBits(m), source: "memory", lo });
    lo += memoryBits(m);
  }
  return t;
}

export const stateBits = (p: Pick<Program, "memory">): number => p.memory.reduce((s, m) => s + memoryBits(m), 0);

/* ── validation ──────────────────────────────────────────────────────────── */

export class ProgramError extends Error {
  override name = "ProgramError";
}

const NAME_RE = /^[a-z][a-zA-Z0-9]{0,23}$/;

function checkOut(o: unknown, where: string): Out {
  if (!o || typeof o !== "object") throw new ProgramError(`${where}: missing`);
  const x = o as Record<string, unknown>;
  const int = (v: unknown, max: number, k: string) => {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) throw new ProgramError(`${where}: ${k} must be 0..${max}`);
    return v as number;
  };
  const out: Out = { want: int(x.want, 7, "want"), mood: int(x.mood, 3, "mood") };
  if (x.nudge !== undefined && x.nudge !== 0) out.nudge = int(x.nudge, 7, "nudge");
  return out;
}

function checkClause(c: unknown, fields: Map<string, FieldInfo>, where: string): Clause {
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new ProgramError(`${where}: a clause must be an object`);
  const out: Clause = {};
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    const f = fields.get(k);
    if (!f) throw new ProgramError(`${where}: unknown field "${k}"`);
    if (!Array.isArray(v) || v.length === 0) throw new ProgramError(`${where}: "${k}" needs at least one value`);
    const max = (1 << f.bits) - 1;
    const set = [...new Set(v)].sort((a, b) => a - b);
    for (const x of set) {
      if (!Number.isInteger(x) || x < 0 || x > max) throw new ProgramError(`${where}: "${k}" values must be 0..${max}`);
    }
    if (set.length <= max) out[k] = set; // every value allowed = no condition
  }
  return out;
}

function checkClauses(cs: unknown, fields: Map<string, FieldInfo>, where: string): Clause[] {
  if (cs === undefined) return [];
  if (!Array.isArray(cs)) throw new ProgramError(`${where}: must be a list of clauses`);
  return cs.map((c, i) => checkClause(c, fields, `${where}[${i}]`));
}

export function validateProgram(input: unknown): Program {
  if (!input || typeof input !== "object") throw new ProgramError("program must be an object");
  const p = input as Record<string, unknown>;
  if (p.version !== PROGRAM_VERSION) throw new ProgramError(`version must be ${PROGRAM_VERSION}`);
  if (!Array.isArray(p.memory)) throw new ProgramError("memory must be a list");
  if (!Array.isArray(p.rules)) throw new ProgramError("rules must be a list");
  if (p.memory.length > MAX_MEMORY_FIELDS) throw new ProgramError(`at most ${MAX_MEMORY_FIELDS} memory fields`);
  if (p.rules.length > MAX_RULES) throw new ProgramError(`at most ${MAX_RULES} rules`);

  const seen = new Set<string>(INPUT_FIELD_NAMES);
  const shells: Memory[] = p.memory.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new ProgramError(`memory[${i}]: must be an object`);
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== "string" || !NAME_RE.test(m.name)) throw new ProgramError(`memory[${i}]: bad name`);
    if (seen.has(m.name)) throw new ProgramError(`memory[${i}]: name "${m.name}" is taken`);
    seen.add(m.name);
    const base = { name: m.name, ...(typeof m.label === "string" && m.label ? { label: m.label.slice(0, 60) } : {}) };
    if (m.kind === "flag") return { ...base, kind: "flag", set: [] };
    if (m.kind === "counter" || m.kind === "timer") {
      if (!Number.isInteger(m.bits) || (m.bits as number) < 1 || (m.bits as number) > 4) {
        throw new ProgramError(`memory[${i}]: bits must be 1..4`);
      }
      return m.kind === "counter"
        ? { ...base, kind: "counter", bits: m.bits as number }
        : { ...base, kind: "timer", bits: m.bits as number, reset: [] };
    }
    throw new ProgramError(`memory[${i}]: kind must be flag, counter or timer`);
  });
  const total = shells.reduce((s, m) => s + memoryBits(m), 0);
  if (total > MAX_MEMORY_BITS) throw new ProgramError(`at most ${MAX_MEMORY_BITS} memory bits`);

  const fields = fieldTable({ memory: shells });
  const memory: Memory[] = shells.map((shell, i) => {
    const m = (p.memory as unknown[])[i] as Record<string, unknown>;
    const w = `memory.${shell.name}`;
    if (shell.kind === "flag") {
      const set = checkClauses(m.set, fields, `${w}.set`);
      const reset = checkClauses(m.reset, fields, `${w}.reset`);
      return { ...shell, set, ...(reset.length ? { reset } : {}) };
    }
    if (shell.kind === "counter") {
      const inc = checkClauses(m.inc, fields, `${w}.inc`);
      const dec = checkClauses(m.dec, fields, `${w}.dec`);
      const reset = checkClauses(m.reset, fields, `${w}.reset`);
      return { ...shell, ...(inc.length ? { inc } : {}), ...(dec.length ? { dec } : {}), ...(reset.length ? { reset } : {}) };
    }
    const count = m.count === undefined ? undefined : checkClauses(m.count, fields, `${w}.count`);
    const reset = checkClauses(m.reset, fields, `${w}.reset`);
    return { ...shell, reset, ...(count ? { count } : {}) };
  });

  const rules: Rule[] = p.rules.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new ProgramError(`rules[${i}]: must be an object`);
    const r = raw as Record<string, unknown>;
    const rule: Rule = { when: checkClause(r.when ?? {}, fields, `rules[${i}].when`), then: checkOut(r.then, `rules[${i}].then`) };
    if (typeof r.label === "string" && r.label) rule.label = r.label.slice(0, 60);
    return rule;
  });
  return { version: PROGRAM_VERSION, memory, rules, otherwise: checkOut(p.otherwise, "otherwise") };
}

/* ── the reference interpreter ───────────────────────────────────────────── */

export interface BeatResult {
  state: number[];
  out: number;
  /** index of the deciding rule, or -1 for otherwise */
  rule: number;
}

export function fieldValue(f: FieldInfo, word: number, state: readonly number[]): number {
  let v = 0;
  for (let b = 0; b < f.bits; b++) {
    const bit = f.source === "input" ? (word >>> (f.lo + b)) & 1 : state[f.lo + b] ? 1 : 0;
    v |= bit << b;
  }
  return v;
}

export function clauseHolds(c: Clause, fields: Map<string, FieldInfo>, word: number, state: readonly number[]): boolean {
  for (const [k, allowed] of Object.entries(c)) {
    if (!allowed.includes(fieldValue(fields.get(k)!, word, state))) return false;
  }
  return true;
}

const anyHolds = (cs: Clause[] | undefined, fields: Map<string, FieldInfo>, w: number, s: readonly number[]) =>
  (cs ?? []).some((c) => clauseHolds(c, fields, w, s));

/** The next value of one memory field, from the state at the start of the beat. */
export function nextMemoryValue(m: Memory, cur: number, fields: Map<string, FieldInfo>, w: number, s: readonly number[]): number {
  if (m.kind === "flag") {
    if (anyHolds(m.reset, fields, w, s)) return 0;
    if (anyHolds(m.set, fields, w, s)) return 1;
    return cur;
  }
  const max = (1 << m.bits) - 1;
  if (anyHolds(m.reset, fields, w, s)) return 0;
  if (m.kind === "timer") {
    const counting = m.count === undefined ? true : anyHolds(m.count, fields, w, s);
    return counting ? Math.min(max, cur + 1) : cur;
  }
  const inc = anyHolds(m.inc, fields, w, s);
  const dec = anyHolds(m.dec, fields, w, s);
  if (inc && !dec) return Math.min(max, cur + 1);
  if (dec && !inc) return Math.max(0, cur - 1);
  return cur;
}

export function runBeat(p: Program, state: readonly number[], word: number): BeatResult {
  const n = stateBits(p);
  if (state.length !== n) throw new Error(`state has ${state.length} bits, program needs ${n}`);
  if (!Number.isInteger(word) || word < 0 || word >= 1 << N_IN) throw new Error("input word out of range");
  const fields = fieldTable(p);
  let rule = -1;
  let out = 0;
  for (let i = 0; i < p.rules.length; i++) {
    const r = p.rules[i]!;
    if (clauseHolds(r.when, fields, word, state)) {
      rule = i;
      out = encodeOutput({ want: r.then.want, mood: r.then.mood, nudge: r.then.nudge ?? 0 });
      break;
    }
  }
  if (rule === -1) out = encodeOutput({ want: p.otherwise.want, mood: p.otherwise.mood, nudge: p.otherwise.nudge ?? 0 });
  const next: number[] = state.slice();
  for (const m of p.memory) {
    const f = fields.get(m.name)!;
    const v = nextMemoryValue(m, fieldValue(f, word, state), fields, word, state);
    for (let b = 0; b < f.bits; b++) next[f.lo + b] = (v >> b) & 1;
  }
  return { state: next, out, rule };
}

export { decodeOutput };
export type { InputField };
