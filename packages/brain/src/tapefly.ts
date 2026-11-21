/**
 * TapeFly-format brains (PRD A1b): the 12-in, 3-out NAND circuits of TapeFly's
 * brawl, read under its public interface draft DUEL-12x3/1, so a Lingxi pet can
 * spar a brain written for TapeFly: the same program format, the same `p1.`
 * link code, and a compiler that produces the same gates, emitted as this
 * package's TAP-02 elements. The chips are the rules TapeFly publishes at
 * /api/v1/brawl.
 *
 * DUEL-12x3/1, input bit 0 first (the order TapeOut's eval packs them):
 *   bits 0-1  dist   0 far .. 3 in reach
 *   bits 2-3  foe    0 moving · 1 shield facing me · 2 winding up a bite · 3 open
 *   bits 4-5  myhp   0 low .. 3 full
 *   bits 6-7  foehp  0 low .. 3 full
 *   bits 8-9  energy 0 none .. 3 full
 *   bits 10-11 previous move
 * outputs: bits 0-1 move (0 press · 1 back · 2 circle · 3 guard), bit 2 bite.
 * The program slots are shared with TapeFly's foraging profile:
 * food=dist, threat=foe, light=myhp, novelty=foehp, hunger=energy, gf=bite.
 */

import { type Circuit, type Element, NAND, encode, load } from "./tap02";

export const DUEL_PROFILE = "DUEL-12x3/1";
export const DUEL_IN = 12;
export const DUEL_OUT = 3;
export const DUEL_MOVES = ["press", "back", "circle", "guard"] as const;
export type DuelMove = (typeof DUEL_MOVES)[number];

const SLOTS = ["food", "threat", "light", "novelty", "hunger"] as const;
type Slot = (typeof SLOTS)[number];
/** DUEL sense names in slot order */
export const DUEL_SENSES = ["dist", "foe", "myhp", "foehp", "energy"] as const;
export type DuelSense = (typeof DUEL_SENSES)[number];

export interface FlyRule {
  when: Partial<Record<Slot, [number, number]>>;
  prev?: number[];
  then: number;
  gf?: boolean;
}
export interface FlyProgram {
  rules: FlyRule[];
  otherwise: { then: number; gf?: boolean };
}

export const FLY_MAX_RULES = 16;

export function validateFlyProgram(p: unknown): FlyProgram {
  const fail = (m: string): never => {
    throw new Error("program: " + m);
  };
  if (!p || typeof p !== "object") fail("not an object");
  const q = p as FlyProgram;
  if (!Array.isArray(q.rules)) fail("rules must be an array");
  if (q.rules.length > FLY_MAX_RULES) fail(`at most ${FLY_MAX_RULES} rules`);
  const lvl = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3;
  const rules: FlyRule[] = q.rules.map((r, i) => {
    if (!r || typeof r !== "object") fail(`rule ${i}: not an object`);
    const when: FlyRule["when"] = {};
    for (const s of SLOTS) {
      const rg = (r.when ?? {})[s];
      if (rg === undefined) continue;
      if (!Array.isArray(rg) || rg.length !== 2 || !lvl(rg[0]) || !lvl(rg[1]) || rg[0] > rg[1]) fail(`rule ${i}: bad range for ${s}`);
      if (!(rg[0] === 0 && rg[1] === 3)) when[s] = [rg[0], rg[1]];
    }
    let prev: number[] | undefined;
    if (r.prev !== undefined) {
      if (!Array.isArray(r.prev) || !r.prev.every(lvl)) fail(`rule ${i}: bad prev`);
      const set = [...new Set(r.prev)].sort();
      if (set.length > 0 && set.length < 4) prev = set;
    }
    if (!lvl(r.then)) fail(`rule ${i}: bad then`);
    const out: FlyRule = { when, then: r.then };
    if (prev) out.prev = prev;
    if (r.gf) out.gf = true;
    return out;
  });
  if (!q.otherwise || !lvl(q.otherwise.then)) fail("otherwise.then must be 0..3");
  return { rules, otherwise: q.otherwise.gf ? { then: q.otherwise.then, gf: true } : { then: q.otherwise.then } };
}

const fieldOf = (w: number, k: number) => (w >> (2 * k)) & 3;

/** The rule list read directly (the compiled circuit must agree on all 4,096 words). */
export function runFlyProgram(p: FlyProgram, w: number): number {
  for (const r of p.rules) {
    let ok = true;
    SLOTS.forEach((s, k) => {
      const rg = r.when[s];
      if (rg && (fieldOf(w, k) < rg[0] || fieldOf(w, k) > rg[1])) ok = false;
    });
    if (ok && r.prev && r.prev.length > 0 && !r.prev.includes((w >> 10) & 3)) ok = false;
    if (ok) return (r.then & 3) | (r.gf ? 4 : 0);
  }
  return (p.otherwise.then & 3) | (p.otherwise.gf ? 4 : 0);
}

/* ── TapeFly's `p1.` link code ─────────────────────────────────────────────
   "p1." + base64url of: 1 byte rule count, 4 bytes per rule, 1 byte otherwise.
   A rule: bits 0-19 five slots × (min 2 bits, max 2 bits), bits 20-23 prev
   mask, bits 24-25 then, bit 26 gf. */

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("program: not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeFlyProgram(p: FlyProgram): string {
  const bytes = new Uint8Array(1 + 4 * p.rules.length + 1);
  bytes[0] = p.rules.length;
  p.rules.forEach((r, i) => {
    let v = 0;
    SLOTS.forEach((s, k) => {
      const [lo, hi] = r.when[s] ?? [0, 3];
      v |= (lo & 3) << (4 * k);
      v |= (hi & 3) << (4 * k + 2);
    });
    let mask = 0;
    for (const b of r.prev ?? []) mask |= 1 << b;
    v |= (mask & 15) << 20;
    v |= (r.then & 3) << 24;
    if (r.gf) v |= 1 << 26;
    const o = 1 + 4 * i;
    bytes[o] = v & 255;
    bytes[o + 1] = (v >>> 8) & 255;
    bytes[o + 2] = (v >>> 16) & 255;
    bytes[o + 3] = (v >>> 24) & 255;
  });
  bytes[bytes.length - 1] = (p.otherwise.then & 3) | (p.otherwise.gf ? 4 : 0);
  return "p1." + b64url(bytes);
}

export function decodeFlyProgram(code: string): FlyProgram {
  if (typeof code !== "string" || !code.startsWith("p1.") || code.length > 200) throw new Error("program: unknown encoding");
  const bytes = unb64url(code.slice(3));
  const n = bytes[0] ?? 0;
  if (bytes.length !== 1 + 4 * n + 1) throw new Error("program: wrong length");
  const rules: FlyRule[] = [];
  for (let i = 0; i < n; i++) {
    const o = 1 + 4 * i;
    const v = (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) >>> 0;
    const when: FlyRule["when"] = {};
    SLOTS.forEach((s, k) => {
      when[s] = [(v >> (4 * k)) & 3, (v >> (4 * k + 2)) & 3];
    });
    const mask = (v >> 20) & 15;
    rules.push({ when, prev: [0, 1, 2, 3].filter((b) => (mask >> b) & 1), then: (v >> 24) & 3, gf: ((v >> 26) & 1) === 1 });
  }
  const last = bytes[bytes.length - 1]!;
  return validateFlyProgram({ rules, otherwise: { then: last & 3, gf: (last & 4) !== 0 } });
}

/* ── TapeFly's brawl chips, as published at /api/v1/brawl ───────────────── */

export interface DuelChip {
  id: string;
  name: { en: string; zh: string };
  rule: { when: Partial<Record<DuelSense, [number, number]>>; then: number; bite?: boolean };
}

export const DUEL_CHIPS: readonly DuelChip[] = [
  { id: "bite", name: { en: "Bite", zh: "先咬" }, rule: { when: { dist: [3, 3], energy: [1, 3] }, then: 0, bite: true } },
  { id: "punish", name: { en: "Punish", zh: "抓破绽" }, rule: { when: { foe: [3, 3], dist: [2, 3] }, then: 0, bite: true } },
  { id: "block", name: { en: "Block", zh: "格挡" }, rule: { when: { foe: [2, 2], dist: [2, 3] }, then: 3 } },
  { id: "sidestep", name: { en: "Sidestep", zh: "闪身" }, rule: { when: { foe: [2, 2] }, then: 2 } },
  { id: "hop", name: { en: "Hop back", zh: "后跳" }, rule: { when: { foe: [2, 2], dist: [3, 3] }, then: 1 } },
  { id: "kite", name: { en: "Kite", zh: "风筝" }, rule: { when: { myhp: [0, 1] }, then: 1 } },
  { id: "breathe", name: { en: "Breathe", zh: "喘口气" }, rule: { when: { energy: [0, 0] }, then: 3 } },
  { id: "finisher", name: { en: "Finisher", zh: "斩杀" }, rule: { when: { foehp: [0, 0] }, then: 0, bite: true } },
  { id: "flank", name: { en: "Flank", zh: "绕开格挡" }, rule: { when: { foe: [1, 1] }, then: 2 } },
  { id: "berserk", name: { en: "Berserk", zh: "拼命" }, rule: { when: { myhp: [0, 0] }, then: 0, bite: true } },
  { id: "bait", name: { en: "Bait", zh: "诱招" }, rule: { when: { foe: [0, 0], dist: [2, 3] }, then: 3 } },
];

/** A chip's name as a player reads it (G8: the ids are TapeFly's, in English); an unknown id is shown as it came. */
export const chipName = (id: string, lang: "en" | "zh"): string => DUEL_CHIPS.find((c) => c.id === id)?.name[lang] ?? id;

/** A chip list, top to bottom, as a program; with nothing matched, press at the rival. */
export function programOfChips(ids: readonly string[]): FlyProgram {
  if (ids.length < 1 || ids.length > FLY_MAX_RULES) throw new Error("chips: 1 to 16");
  const rules = ids.map((id) => {
    const c = DUEL_CHIPS.find((x) => x.id === id);
    if (!c) throw new Error(`chips: unknown chip ${id}`);
    const when: FlyRule["when"] = {};
    DUEL_SENSES.forEach((s, k) => {
      const rg = c.rule.when[s];
      if (rg) when[SLOTS[k]!] = [rg[0], rg[1]];
    });
    return { when, then: c.rule.then, ...(c.rule.bite ? { gf: true } : {}) };
  });
  return validateFlyProgram({ rules, otherwise: { then: 0 } });
}

/* ── the compiler ─────────────────────────────────────────────────────── */

const C0 = 0;
const C1 = 1;

class FlyBuilder {
  gates: [number, number][] = [];
  private cache = new Map<string, number>();
  private inv = new Map<number, number>();
  readonly base = 2 + DUEL_IN;

  input(i: number) {
    return 2 + i;
  }
  nand(a: number, b: number): number {
    if (a > b) [a, b] = [b, a];
    if (a === C0) return C1;
    if (a === C1) return this.not(b);
    if (this.inv.get(a) === b) return C1;
    const key = a + "," + b;
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
    return this.not(this.nand(a, b));
  }
  or(a: number, b: number): number {
    if (a === C1 || b === C1) return C1;
    if (a === C0) return b;
    if (b === C0) return a;
    if (a === b) return a;
    return this.nand(this.not(a), this.not(b));
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
  fieldIs(lo: number, v: number): number {
    const b0 = this.input(lo);
    const b1 = this.input(lo + 1);
    return this.and(v & 1 ? b0 : this.not(b0), v & 2 ? b1 : this.not(b1));
  }
  fieldIn(lo: number, mask: number): number {
    mask &= 15;
    if (mask === 0) return C0;
    if (mask === 15) return C1;
    const b0 = this.input(lo);
    const b1 = this.input(lo + 1);
    if (mask === 0b1100) return b1;
    if (mask === 0b0011) return this.not(b1);
    if (mask === 0b1010) return b0;
    if (mask === 0b0101) return this.not(b0);
    const pc = [0, 1, 2, 3].filter((v) => (mask >> v) & 1);
    if (pc.length === 3) return this.not(this.fieldIs(lo, [0, 1, 2, 3].find((v) => !((mask >> v) & 1))!));
    if (mask === 0b1001) return this.not(this.xor(b0, b1));
    if (mask === 0b0110) return this.xor(b0, b1);
    return this.orAll(pc.map((v) => this.fieldIs(lo, v)));
  }
  xor(a: number, b: number): number {
    const n = this.nand(a, b);
    return this.nand(this.nand(a, n), this.nand(b, n));
  }
}

/** gates[i] = the two signals NAND-ed into signal 2 + 12 + i; the last 3 are the outputs. */
export type FlyGates = [number, number][];

const rangeMask = (lo: number, hi: number) => {
  let m = 0;
  for (let v = lo; v <= hi; v++) m |= 1 << v;
  return m;
};

function buildFly(p: FlyProgram, strategy: "chain" | "tree" | "mux"): FlyGates {
  const B = new FlyBuilder();
  const m = p.rules.map((r) => {
    const conds: number[] = [];
    SLOTS.forEach((s, k) => {
      const rg = r.when[s];
      if (rg) conds.push(B.fieldIn(2 * k, rangeMask(rg[0], rg[1])));
    });
    if (r.prev && r.prev.length > 0) {
      let mask = 0;
      for (const b of r.prev) mask |= 1 << b;
      conds.push(B.fieldIn(10, mask));
    }
    return B.andAll(conds);
  });
  const outs = p.rules.map((r) => (r.then & 3) | (r.gf ? 4 : 0));
  const other = (p.otherwise.then & 3) | (p.otherwise.gf ? 4 : 0);
  const bits: number[] = [];
  if (strategy === "mux") {
    for (let k = 0; k < DUEL_OUT; k++) {
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
    return finishFly(B.gates, bits);
  }
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
  for (let k = 0; k < DUEL_OUT; k++) {
    const terms = fire.filter((_, i) => (outs[i]! >> k) & 1);
    if ((other >> k) & 1) terms.push(free);
    bits.push(B.orAll(terms));
  }
  return finishFly(B.gates, bits);
}

function finishFly(gates: FlyGates, bits: number[]): FlyGates {
  const base = 2 + DUEL_IN;
  const finals: [number, number][] = [];
  const all = gates.slice();
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
  const stack: number[] = [];
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
  const out: FlyGates = [];
  for (let i = 0; i < all.length; i++) {
    if (!live[i]) continue;
    const [a, b] = all[i]!;
    remap.set(base + i, base + out.length);
    out.push([remap.get(a)!, remap.get(b)!]);
  }
  for (const [a, b] of finals) out.push([remap.get(a)!, remap.get(b)!]);
  return out;
}

function flyDepth(g: FlyGates): number {
  const base = 2 + DUEL_IN;
  const d = new Array<number>(base + g.length).fill(0);
  let max = 0;
  g.forEach(([a, b], i) => {
    d[base + i] = 1 + Math.max(d[a]!, d[b]!);
    max = Math.max(max, d[base + i]!);
  });
  return max;
}
const flyCost = (g: FlyGates) => g.length * flyDepth(g) ** 3;

/** Compile like TapeFly: three encodings, the lowest TapeOut cost A×d³ wins. */
export function compileFlyProgram(p: FlyProgram): FlyGates {
  const tries = (["chain", "tree", "mux"] as const).map((s) => buildFly(p, s));
  return tries.reduce((best, n) => (flyCost(n) < flyCost(best) || (flyCost(n) === flyCost(best) && n.length < best.length) ? n : best));
}

/** The gates as TAP-02 bytes, ready to tape out or to evaluate as a circuit. */
export function flyCircuitBytes(g: FlyGates): Uint8Array {
  const base = 2 + DUEL_IN;
  const els: Element[] = g.map(([a, b], i) => ({ op: NAND, ins: [a, b], nOut: 1, firstOut: base + i }));
  return encode(els);
}

export function flyCircuit(g: FlyGates): Circuit {
  return load(flyCircuitBytes(g), DUEL_IN, DUEL_OUT);
}
