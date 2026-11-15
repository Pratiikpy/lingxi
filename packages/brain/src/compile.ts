/**
 * Program → NAND + LATCH netlist in TapeOut's encoding (TAP-02).
 *
 * Layout of the emitted circuit:
 *   signals 0, 1            constants
 *   signals 2 .. 17         the 16 input pins (src/pins.ts)
 *   signals 18 .. 18+S-1    one LATCH per memory bit, in program order; each d
 *                           points forward to the gate that computes its next value
 *   then the NAND gates, and the last 8 gates are the 8 outputs
 *
 * The builder hashes structurally (the same NAND is never built twice), folds
 * constants, cancels double negation and drops gates nothing depends on. Rule
 * priority is built three ways (a chain, prefix trees, and per-bit multiplexers)
 * and the circuit with the lowest TapeOut cost A×d³ is kept.
 *
 * Adapted from TapeFly's sim/compile.ts (MIT), extended with memory: field
 * comparators over any width, LATCH state, and next-state logic synthesised
 * from each memory field's truth table.
 */

import { LATCH, NAND, type Element, encode } from "./tap02";
import { N_IN, N_OUT, encodeOutput } from "./pins";
import {
  type Clause,
  type FieldInfo,
  type Memory,
  type Program,
  fieldTable,
  memoryBits,
  stateBits,
} from "./program";

const C0 = 0;
const C1 = 1;

export interface PetNetlist {
  version: string;
  nIn: number;
  nOut: number;
  /** d signal of each LATCH, in final numbering; LATCH j outputs signal 2 + nIn + j */
  latches: number[];
  /** NAND gates in final numbering; gate i outputs signal 2 + nIn + latches.length + i */
  gates: [number, number][];
}

class Builder {
  readonly gates: [number, number][] = [];
  private readonly cache = new Map<string, number>();
  private readonly inv = new Map<number, number>();
  private readonly fnMemo = new Map<string, number>();

  constructor(
    readonly nIn: number,
    readonly nState: number,
  ) {}

  get base(): number {
    return 2 + this.nIn + this.nState;
  }
  input(i: number): number {
    return 2 + i;
  }
  latch(j: number): number {
    return 2 + this.nIn + j;
  }

  nand(x: number, y: number): number {
    let a = x;
    let b = y;
    if (a > b) [a, b] = [b, a];
    if (a === C0) return C1;
    if (a === C1) return this.not(b);
    if (this.inv.get(a) === b) return C1;
    const key = `${a},${b}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const s = this.base + this.gates.length;
    this.gates.push([a, b]);
    this.cache.set(key, s);
    if (a === b) {
      this.inv.set(a, s);
      this.inv.set(s, a);
    }
    return s;
  }
  not(a: number): number {
    if (a === C0) return C1;
    if (a === C1) return C0;
    const k = this.inv.get(a);
    if (k !== undefined) return k;
    return this.nand(a, a);
  }
  and(a: number, b: number): number {
    if (a === C0 || b === C0) return C0;
    if (a === C1) return b;
    if (b === C1) return a;
    if (a === b) return a;
    if (this.inv.get(a) === b) return C0;
    return this.not(this.nand(a, b));
  }
  or(a: number, b: number): number {
    if (a === C1 || b === C1) return C1;
    if (a === C0) return b;
    if (b === C0) return a;
    if (a === b) return a;
    if (this.inv.get(a) === b) return C1;
    return this.nand(this.not(a), this.not(b));
  }
  mux(sel: number, hi: number, lo: number): number {
    if (hi === lo) return hi;
    if (hi === C1 && lo === C0) return sel;
    if (hi === C0 && lo === C1) return this.not(sel);
    if (lo === C0) return this.and(sel, hi);
    if (hi === C0) return this.and(this.not(sel), lo);
    if (lo === C1) return this.or(this.not(sel), hi);
    if (hi === C1) return this.or(sel, lo);
    return this.nand(this.nand(sel, hi), this.nand(this.not(sel), lo));
  }
  andAll(xs: number[]): number {
    if (xs.length === 0) return C1;
    if (xs.length === 1) return xs[0]!;
    const h = xs.length >> 1;
    return this.and(this.andAll(xs.slice(0, h)), this.andAll(xs.slice(h)));
  }
  orAll(xs: number[]): number {
    if (xs.length === 0) return C0;
    if (xs.length === 1) return xs[0]!;
    const h = xs.length >> 1;
    return this.or(this.orAll(xs.slice(0, h)), this.orAll(xs.slice(h)));
  }

  /**
   * Any boolean function of the given signals, from its truth table
   * (table[i] is the value when signal k holds bit k of i). Shannon expansion on
   * the highest variable, memoised on the sub-table so equal cofactors share gates.
   */
  fn(vars: readonly number[], table: readonly number[]): number {
    if (table.length !== 1 << vars.length) throw new Error("truth table size mismatch");
    let all0 = true;
    let all1 = true;
    for (const t of table) {
      if (t) all0 = false;
      else all1 = false;
    }
    if (all0) return C0;
    if (all1) return C1;
    const key = `${vars.join(",")}|${table.join("")}`;
    const hit = this.fnMemo.get(key);
    if (hit !== undefined) return hit;
    const n = vars.length;
    const half = 1 << (n - 1);
    const top = vars[n - 1]!;
    const rest = vars.slice(0, n - 1);
    const lo = this.fn(rest, table.slice(0, half));
    const hi = this.fn(rest, table.slice(half));
    const s = this.mux(top, hi, lo);
    this.fnMemo.set(key, s);
    return s;
  }

  /** The field (bit signals, least significant first) holds one of `allowed`. */
  fieldIn(bits: readonly number[], allowed: readonly number[]): number {
    const set = new Set(allowed);
    const table = Array.from({ length: 1 << bits.length }, (_, v) => (set.has(v) ? 1 : 0));
    return this.fn(bits, table);
  }
}

function fieldSignals(B: Builder, f: FieldInfo): number[] {
  return Array.from({ length: f.bits }, (_, b) => (f.source === "input" ? B.input(f.lo + b) : B.latch(f.lo + b)));
}

function clauseSignal(B: Builder, fields: Map<string, FieldInfo>, c: Clause): number {
  const conds = Object.entries(c).map(([k, allowed]) => B.fieldIn(fieldSignals(B, fields.get(k)!), allowed));
  return B.andAll(conds);
}

const anySignal = (B: Builder, fields: Map<string, FieldInfo>, cs: Clause[] | undefined) =>
  B.orAll((cs ?? []).map((c) => clauseSignal(B, fields, c)));

/** Next-state signals for one memory field, least significant bit first. */
function memoryNext(B: Builder, fields: Map<string, FieldInfo>, m: Memory): number[] {
  const f = fields.get(m.name)!;
  const cur = fieldSignals(B, f);
  const n = memoryBits(m);
  const max = (1 << n) - 1;
  const R = anySignal(B, fields, m.reset);
  let ctl: number[];
  let next: (v: number, c: number[]) => number;
  if (m.kind === "flag") {
    ctl = [R, anySignal(B, fields, m.set)];
    next = (v, [r, s]) => (r ? 0 : s ? 1 : v);
  } else if (m.kind === "timer") {
    ctl = [R, m.count === undefined ? C1 : anySignal(B, fields, m.count)];
    next = (v, [r, c]) => (r ? 0 : c ? Math.min(max, v + 1) : v);
  } else {
    ctl = [R, anySignal(B, fields, m.inc), anySignal(B, fields, m.dec)];
    next = (v, [r, i, d]) => (r ? 0 : i && !d ? Math.min(max, v + 1) : d && !i ? Math.max(0, v - 1) : v);
  }
  // Constant controls shrink the table instead of becoming variables.
  const live: number[] = [];
  const liveIdx: number[] = [];
  ctl.forEach((s, i) => {
    if (s !== C0 && s !== C1) {
      live.push(s);
      liveIdx.push(i);
    }
  });
  const vars = [...cur, ...live];
  const outs: number[] = [];
  for (let b = 0; b < n; b++) {
    const table = Array.from({ length: 1 << vars.length }, (_, i) => {
      const v = i & max;
      const c: number[] = ctl.map((s) => (s === C1 ? 1 : 0));
      liveIdx.forEach((ci, k) => {
        c[ci] = (i >> (n + k)) & 1;
      });
      return (next(v, c) >> b) & 1;
    });
    outs.push(B.fn(vars, table));
  }
  return outs;
}

type Strategy = "chain" | "tree" | "mux";

function build(p: Program, strategy: Strategy, version: string): PetNetlist {
  const fields = fieldTable(p);
  const nState = stateBits(p);
  const B = new Builder(N_IN, nState);
  const m = p.rules.map((r) => clauseSignal(B, fields, r.when));
  const outs = p.rules.map((r) => encodeOutput({ want: r.then.want, mood: r.then.mood, nudge: r.then.nudge ?? 0 }));
  const other = encodeOutput({ want: p.otherwise.want, mood: p.otherwise.mood, nudge: p.otherwise.nudge ?? 0 });

  const bits: number[] = [];
  if (strategy === "mux") {
    for (let k = 0; k < N_OUT; k++) {
      let v = (other >> k) & 1 ? C1 : C0;
      let i = m.length - 1;
      while (i >= 0) {
        const bit = (outs[i]! >> k) & 1;
        let j = i;
        while (j - 1 >= 0 && ((outs[j - 1]! >> k) & 1) === bit) j--;
        const M = B.orAll(m.slice(j, i + 1));
        v = bit ? B.or(M, v) : B.and(B.not(M), v);
        i = j - 1;
      }
      bits.push(v);
    }
  } else {
    const fire: number[] = [];
    let free = C1;
    if (strategy === "tree") {
      for (let i = 0; i < m.length; i++) fire.push(B.and(m[i]!, B.not(B.orAll(m.slice(0, i)))));
      free = B.not(B.orAll(m));
    } else {
      for (let i = 0; i < m.length; i++) {
        fire.push(B.and(free, m[i]!));
        free = B.and(free, B.not(m[i]!));
      }
    }
    for (let k = 0; k < N_OUT; k++) {
      const terms = fire.filter((_, i) => (outs[i]! >> k) & 1);
      if ((other >> k) & 1) terms.push(free);
      bits.push(B.orAll(terms));
    }
  }

  const dSignals: number[] = [];
  for (const mem of p.memory) dSignals.push(...memoryNext(B, fields, mem));
  return finish(B, bits, dSignals, version);
}

/**
 * Re-emit so the outputs are the last gates, drop dead gates and renumber.
 * Each output gets one final gate: a copy of its gate when that gate is not
 * already some other output's final, otherwise NOT(NOT s).
 */
function finish(B: Builder, bits: number[], dSignals: number[], version: string): PetNetlist {
  const base = B.base;
  const all = B.gates.slice();
  const finals: [number, number][] = [];
  const used = new Set<number>();
  for (const s of bits) {
    if (s >= base && !used.has(s)) {
      finals.push(all[s - base]!);
      used.add(s);
    } else {
      all.push([s, s]);
      const ns = base + all.length - 1;
      finals.push([ns, ns]);
    }
  }
  const live = new Uint8Array(all.length);
  const stack: number[] = [...dSignals];
  for (const [a, b] of finals) stack.push(a, b);
  while (stack.length) {
    const s = stack.pop()!;
    if (s < base) continue;
    const i = s - base;
    if (live[i]) continue;
    live[i] = 1;
    stack.push(all[i]![0], all[i]![1]);
  }
  const remap = new Map<number, number>();
  for (let s = 0; s < base; s++) remap.set(s, s);
  const out: [number, number][] = [];
  for (let i = 0; i < all.length; i++) {
    if (!live[i]) continue;
    const [a, b] = all[i]!;
    remap.set(base + i, base + out.length);
    out.push([remap.get(a)!, remap.get(b)!]);
  }
  for (const [a, b] of finals) out.push([remap.get(a)!, remap.get(b)!]);
  const latches = dSignals.map((d) => remap.get(d)!);
  return { version, nIn: B.nIn, nOut: N_OUT, latches, gates: out };
}

/* ── measures ────────────────────────────────────────────────────────────── */

/** Logic depth of the deepest gate; LATCH outputs count as depth 0. */
export function netDepth(n: PetNetlist): number {
  const base = 2 + n.nIn + n.latches.length;
  const d = new Array<number>(base + n.gates.length).fill(0);
  let max = 0;
  n.gates.forEach(([a, b], i) => {
    const v = 1 + Math.max(d[a]!, d[b]!);
    d[base + i] = v;
    if (v > max) max = v;
  });
  return max;
}

/** Gates as TapeOut counts them: every NAND and every LATCH. */
export const gateCount = (n: PetNetlist): number => n.gates.length + n.latches.length;

/** TapeOut ranking cost C = A × d³. */
export function cost(n: PetNetlist): number {
  const d = netDepth(n);
  return gateCount(n) * d * d * d;
}

export function compileProgram(p: Program, version = "LX-PET/1"): PetNetlist {
  const tries = (["chain", "tree", "mux"] as const).map((s) => build(p, s, version));
  return tries.reduce((best, n) =>
    cost(n) < cost(best) || (cost(n) === cost(best) && gateCount(n) < gateCount(best)) ? n : best,
  );
}

/* ── bytes ───────────────────────────────────────────────────────────────── */

/** TAP-02 elements: every LATCH first, then every NAND. */
export function toElements(n: PetNetlist): Element[] {
  let next = 2 + n.nIn;
  const els: Element[] = [];
  for (const d of n.latches) els.push({ op: LATCH, ins: [d], nOut: 1, firstOut: next++ });
  for (const [a, b] of n.gates) els.push({ op: NAND, ins: [a, b], nOut: 1, firstOut: next++ });
  return els;
}

/** The bytes passed to `tapeout(bytes nl, uint32 nIn, uint32 nOut)`. */
export const netlistBytes = (n: PetNetlist): Uint8Array => encode(toElements(n));
