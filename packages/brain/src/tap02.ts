/**
 * TapeOut netlist format and one-beat evaluation (TAP-02), as the deployed
 * processors run it on X Layer.
 *
 * Signals: 0 is constant 0, 1 is constant 1, 2..2+nIn-1 are the inputs, then
 * each element appends its outputs in record order. The circuit's outputs are
 * the last nOut signals.
 *
 * Records:
 *   NAND   0x00 a(u24) b(u24)                         one output, reads earlier signals
 *   LATCH  0x01 d(u24)                                one output: the bit stored last beat;
 *                                                     d may point forward (feedback)
 *   REF    0x02 cpu(20) id(u64) nIns(u8) nOuts(u8) ins(u24 each)
 *                                                     a sub-circuit; its state is a block
 *                                                     of this circuit's state
 *
 * State is a packed bit vector, least significant bit first. Each LATCH takes the
 * next bit in record order; each REF takes a block the size of its target's state.
 */

export const NAND = 0x00;
export const LATCH = 0x01;
export const REF = 0x02;

export const MAX_SIGNALS = 1 << 24;
export const MAX_PINS = 1 << 16;
export const MAX_GATES = 2 ** 32 - 1;

export class IllFormed extends Error {
  override name = "IllFormed";
}

export type Bit = 0 | 1;

export interface NandElement {
  op: typeof NAND;
  ins: [number, number];
  nOut: 1;
  firstOut: number;
}
export interface LatchElement {
  op: typeof LATCH;
  ins: [number];
  nOut: 1;
  firstOut: number;
}
export interface RefElement {
  op: typeof REF;
  ins: number[];
  /** lower-case 0x-prefixed 20-byte address */
  cpu: string;
  id: bigint;
  nOut: number;
  firstOut: number;
}
export type Element = NandElement | LatchElement | RefElement;

export interface Circuit {
  nIn: number;
  nOut: number;
  elements: Element[];
  nSignals: number;
  nState: number;
  /** NAND + LATCH at this level plus every REF target's gate count */
  nGates: number;
  /** state offset of each element, same order as elements */
  stateBase: number[];
  /** REF targets, keyed by refKey(cpu, id) */
  subs: Map<string, Circuit>;
}

export type Resolver = (cpu: string, id: bigint) => Circuit | null | undefined;

export const refKey = (cpu: string, id: bigint): string => `${cpu.toLowerCase()}:${id.toString()}`;

/* ── hex helpers ─────────────────────────────────────────────────────────── */

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd hex length");
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("not hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/* ── decode and encode ───────────────────────────────────────────────────── */

export function decode(data: Uint8Array, nIn: number): Element[] {
  let p = 0;
  let next = 2 + nIn;
  const els: Element[] = [];
  const take = (k: number): Uint8Array => {
    if (p + k > data.length) throw new IllFormed(`truncated record at byte ${p}`);
    const b = data.subarray(p, p + k);
    p += k;
    return b;
  };
  const u24 = (): number => {
    const b = take(3);
    return (b[0]! << 16) | (b[1]! << 8) | b[2]!;
  };
  while (p < data.length) {
    const op = take(1)[0]!;
    let e: Element;
    if (op === NAND) {
      const a = u24();
      const b = u24();
      e = { op: NAND, ins: [a, b], nOut: 1, firstOut: next };
    } else if (op === LATCH) {
      e = { op: LATCH, ins: [u24()], nOut: 1, firstOut: next };
    } else if (op === REF) {
      const cpu = bytesToHex(take(20));
      let id = 0n;
      for (const x of take(8)) id = (id << 8n) | BigInt(x);
      const ni = take(1)[0]!;
      const no = take(1)[0]!;
      const ins: number[] = [];
      for (let i = 0; i < ni; i++) ins.push(u24());
      e = { op: REF, ins, cpu, id, nOut: no, firstOut: next };
    } else {
      throw new IllFormed(`unknown opcode 0x${op.toString(16).padStart(2, "0")} at byte ${p - 1}`);
    }
    next += e.nOut;
    els.push(e);
  }
  return els;
}

export function encode(els: readonly Element[]): Uint8Array {
  const out: number[] = [];
  const u24 = (s: number) => {
    if (!(Number.isInteger(s) && s >= 0 && s < MAX_SIGNALS)) throw new Error(`signal ${s} out of range`);
    out.push((s >> 16) & 0xff, (s >> 8) & 0xff, s & 0xff);
  };
  for (const e of els) {
    out.push(e.op);
    if (e.op === REF) {
      for (const b of hexToBytes(e.cpu)) out.push(b);
      let id = e.id;
      const idb: number[] = [];
      for (let i = 0; i < 8; i++) {
        idb.unshift(Number(id & 0xffn));
        id >>= 8n;
      }
      out.push(...idb, e.ins.length, e.nOut);
    }
    for (const s of e.ins) u24(s);
  }
  return Uint8Array.from(out);
}

/* ── well-formedness ─────────────────────────────────────────────────────── */

export function load(data: Uint8Array, nIn: number, nOut: number, resolve?: Resolver): Circuit {
  const els = decode(data, nIn);
  const nSig = 2 + nIn + els.reduce((s, e) => s + e.nOut, 0);
  if (nSig > MAX_SIGNALS) throw new IllFormed("more than 2^24 signals");
  if (!(nIn >= 0 && nIn <= MAX_PINS && nOut >= 1 && nOut <= MAX_PINS)) throw new IllFormed("nIn/nOut out of range");
  if (nSig - 2 - nIn < nOut) throw new IllFormed("too few signals for outputs");
  const c: Circuit = {
    nIn,
    nOut,
    elements: els,
    nSignals: nSig,
    nState: 0,
    nGates: 0,
    stateBase: [],
    subs: new Map(),
  };
  for (const e of els) {
    for (const s of e.ins) {
      const limit = e.op === LATCH ? nSig : e.firstOut;
      if (s >= limit) throw new IllFormed(`signal ${s} referenced by element at ${e.firstOut} is not available`);
    }
    c.stateBase.push(c.nState);
    if (e.op === LATCH) {
      c.nState += 1;
    } else if (e.op === REF) {
      if (!resolve) throw new IllFormed("REF without a resolver");
      const sub = resolve(e.cpu, e.id);
      if (!sub) throw new IllFormed("REF target is not a circuit of a registered processor");
      if (sub.nIn !== e.ins.length || sub.nOut !== e.nOut)
        throw new IllFormed("REF arity does not match the target circuit");
      if (sub.nState > MAX_SIGNALS) throw new IllFormed("REF size");
      c.subs.set(refKey(e.cpu, e.id), sub);
      c.nState += sub.nState;
      c.nGates += sub.nGates;
    }
  }
  c.nGates += els.filter((e) => e.op !== REF).length;
  if (c.nState > MAX_SIGNALS || c.nGates > MAX_GATES) throw new IllFormed("size overflow");
  return c;
}

/* ── one beat ────────────────────────────────────────────────────────────── */

/** One beat (TAP-02 §4). Returns [newState, outputs]; both arrays of bits. */
export function beat(c: Circuit, state: readonly number[], inputs: readonly number[]): [Bit[], Bit[]] {
  if (state.length !== c.nState) throw new Error(`state has ${state.length} bits, circuit needs ${c.nState}`);
  if (inputs.length !== c.nIn) throw new Error(`inputs have ${inputs.length} bits, circuit needs ${c.nIn}`);
  const a: Bit[] = [0, 1];
  for (const x of inputs) a.push(x ? 1 : 0);
  const newState: Bit[] = state.map((x) => (x ? 1 : 0));
  c.elements.forEach((e, k) => {
    const base = c.stateBase[k]!;
    if (e.op === NAND) {
      a.push(a[e.ins[0]]! & a[e.ins[1]]! ? 0 : 1);
    } else if (e.op === LATCH) {
      a.push(state[base] ? 1 : 0);
    } else {
      const sub = c.subs.get(refKey(e.cpu, e.id))!;
      const [ns, outs] = beat(
        sub,
        state.slice(base, base + sub.nState),
        e.ins.map((s) => a[s]!),
      );
      for (let i = 0; i < ns.length; i++) newState[base + i] = ns[i]!;
      a.push(...outs);
    }
  });
  c.elements.forEach((e, k) => {
    if (e.op === LATCH) newState[c.stateBase[k]!] = a[e.ins[0]]!;
  });
  return [newState, a.slice(a.length - c.nOut)];
}

/* ── packing, exactly as the deployed evaluator reads it ─────────────────── */

export function pack(bits: readonly number[]): Uint8Array {
  const out = new Uint8Array((bits.length + 7) >> 3);
  bits.forEach((v, i) => {
    if (v) out[i >> 3]! |= 1 << (i & 7);
  });
  return out;
}

/** Missing bytes read as 0; extra bytes and bits are ignored. */
export function unpack(data: Uint8Array, n: number): Bit[] {
  const bits: Bit[] = [];
  for (let i = 0; i < n; i++) bits.push(i >> 3 < data.length ? (((data[i >> 3]! >> (i & 7)) & 1) as Bit) : 0);
  return bits;
}

/** Integer word (bit i = pin i) to a bit array of length n, and back. */
export function wordToBits(word: number | bigint, n: number): Bit[] {
  const w = BigInt(word);
  const out: Bit[] = [];
  for (let i = 0; i < n; i++) out.push(((w >> BigInt(i)) & 1n) === 1n ? 1 : 0);
  return out;
}

export function bitsToWord(bits: readonly number[]): bigint {
  let w = 0n;
  for (let i = bits.length - 1; i >= 0; i--) w = (w << 1n) | (bits[i] ? 1n : 0n);
  return w;
}
