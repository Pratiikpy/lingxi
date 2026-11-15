import { describe, expect, it } from "vitest";
import { compileProgram, cost, gateCount, netDepth, netlistBytes } from "../src/compile";
import { fastBrain } from "../src/fast";
import { INPUT_FIELDS, N_IN, N_OUT } from "../src/pins";
import { type Clause, type Program, runBeat, stateBits, validateProgram } from "../src/program";
import { STARTERS } from "../src/starters";
import { beat, load } from "../src/tap02";

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const bitsOf = (w: number, n: number) => Array.from({ length: n }, (_, i) => (w >>> i) & 1);
const wordOf = (bits: readonly number[]) => bits.reduce((w, b, i) => w | (b << i), 0);

function checkAgainstInterpreter(p: Program, cases: Array<[number[], number]>) {
  const net = compileProgram(p);
  const c = load(netlistBytes(net), N_IN, N_OUT);
  expect(c.nState).toBe(stateBits(p));
  const fast = fastBrain(net);
  for (const [state, word] of cases) {
    const want = runBeat(p, state, word);
    const [ns, outs] = beat(c, state, bitsOf(word, N_IN));
    expect(wordOf(outs), `out for word ${word} state ${state.join("")}`).toBe(want.out);
    expect(ns, `state for word ${word}`).toEqual(want.state);
    const st = Uint8Array.from(state);
    expect(fast.step(st, word)).toBe(want.out);
    expect(Array.from(st)).toEqual(want.state);
  }
}

describe("starter brains", () => {
  for (const [name, p] of Object.entries(STARTERS)) {
    describe(name, () => {
      const net = compileProgram(p);

      it("loads as a well-formed TapeOut circuit", () => {
        const c = load(netlistBytes(net), N_IN, N_OUT);
        expect(c.nIn).toBe(16);
        expect(c.nOut).toBe(8);
        expect(c.nState).toBe(stateBits(p));
        expect(c.nGates).toBe(gateCount(net));
      });

      it("is within the size budget (300-500 gates, small depth)", () => {
        expect(gateCount(net)).toBeLessThanOrEqual(500);
        expect(netDepth(net)).toBeLessThanOrEqual(40);
        expect(cost(net)).toBeGreaterThan(0);
      });

      it("matches the interpreter on all 65,536 input words at the zero state", () => {
        const fast = fastBrain(net);
        const zero = new Array(stateBits(p)).fill(0);
        for (let w = 0; w < 1 << N_IN; w++) {
          const want = runBeat(p, zero, w);
          const st = new Uint8Array(zero.length);
          const out = fast.step(st, w);
          if (out !== want.out || Array.from(st).join("") !== want.state.join("")) {
            throw new Error(`word ${w}: got ${out}/${Array.from(st).join("")}, want ${want.out}/${want.state.join("")}`);
          }
        }
      });

      it("matches the interpreter on 200,000 random state and input pairs", () => {
        const r = rng(name.length * 7919);
        const fast = fastBrain(net);
        const n = stateBits(p);
        for (let i = 0; i < 200_000; i++) {
          const state = Array.from({ length: n }, () => (r() < 0.5 ? 1 : 0));
          const w = Math.floor(r() * (1 << N_IN));
          const want = runBeat(p, state, w);
          const st = Uint8Array.from(state);
          const out = fast.step(st, w);
          if (out !== want.out || Array.from(st).join("") !== want.state.join("")) {
            throw new Error(`case ${i}: mismatch at word ${w}`);
          }
        }
      });

      it("agrees with the TAP-02 reference evaluator along a 10,000-beat life", () => {
        const r = rng(42 + name.length);
        const c = load(netlistBytes(net), N_IN, N_OUT);
        let state = new Array(stateBits(p)).fill(0);
        let st2 = new Array(stateBits(p)).fill(0);
        for (let i = 0; i < 10_000; i++) {
          const w = Math.floor(r() * (1 << N_IN));
          const want = runBeat(p, state, w);
          const [ns, outs] = beat(c, st2, bitsOf(w, N_IN));
          expect(wordOf(outs)).toBe(want.out);
          expect(ns).toEqual(want.state);
          state = want.state;
          st2 = ns;
        }
      });
    });
  }
});

describe("memory semantics", () => {
  const base = { version: "LX-PET/1" as const, otherwise: { want: 0, mood: 1 } };

  it("a flag: reset wins over set, and it holds its value otherwise", () => {
    const p = validateProgram({
      ...base,
      memory: [{ name: "f", kind: "flag", set: [{ action: [1] }], reset: [{ action: [2] }] }],
      rules: [{ when: { f: [1] }, then: { want: 2, mood: 3 } }],
    });
    const feed = 1 << 10;
    const play = 2 << 10;
    expect(runBeat(p, [0], feed).state).toEqual([1]);
    expect(runBeat(p, [1], 0).state).toEqual([1]);
    expect(runBeat(p, [1], play).state).toEqual([0]);
    // memory is read as it was at the start of the beat
    expect(runBeat(p, [0], feed).out).toBe(0 | (1 << 3));
    expect(runBeat(p, [1], 0).out).toBe(2 | (3 << 3));
    checkAgainstInterpreter(p, [[[0], feed], [[1], 0], [[1], play], [[0], 0]]);
  });

  it("a counter saturates at both ends, and inc with dec together cancel", () => {
    const p = validateProgram({
      ...base,
      memory: [{ name: "c", kind: "counter", bits: 2, inc: [{ action: [1] }, { owner: [1] }], dec: [{ action: [2] }, { owner: [1] }] }],
      rules: [],
    });
    const feed = 1 << 10;
    const play = 2 << 10;
    const here = 1 << 15;
    expect(runBeat(p, [1, 1], feed).state).toEqual([1, 1]);
    expect(runBeat(p, [0, 0], play).state).toEqual([0, 0]);
    expect(runBeat(p, [1, 0], feed).state).toEqual([0, 1]);
    expect(runBeat(p, [1, 0], here).state).toEqual([1, 0]);
    const cases: Array<[number[], number]> = [];
    for (let s = 0; s < 4; s++) for (const w of [0, feed, play, here, feed | here]) cases.push([bitsOf(s, 2), w]);
    checkAgainstInterpreter(p, cases);
  });

  it("a timer counts every beat, saturates, and resets", () => {
    const p = validateProgram({
      ...base,
      memory: [{ name: "t", kind: "timer", bits: 2, reset: [{ action: [4] }] }],
      rules: [{ when: { t: [3] }, then: { want: 3, mood: 0 } }],
    });
    let s = [0, 0];
    for (let i = 0; i < 5; i++) s = runBeat(p, s, 0).state;
    expect(s).toEqual([1, 1]);
    expect(runBeat(p, s, 4 << 10).state).toEqual([0, 0]);
    const cases: Array<[number[], number]> = [];
    for (let v = 0; v < 4; v++) for (const w of [0, 4 << 10]) cases.push([bitsOf(v, 2), w]);
    checkAgainstInterpreter(p, cases);
  });

  it("a gated timer only counts while its condition holds", () => {
    const p = validateProgram({
      ...base,
      memory: [{ name: "t", kind: "timer", bits: 3, count: [{ owner: [0] }], reset: [{ action: [5] }] }],
      rules: [],
    });
    expect(runBeat(p, [0, 0, 0], 1 << 15).state).toEqual([0, 0, 0]);
    expect(runBeat(p, [0, 0, 0], 0).state).toEqual([1, 0, 0]);
  });
});

describe("validation", () => {
  const base = { version: "LX-PET/1", memory: [], otherwise: { want: 0, mood: 1 } };
  it("rejects unknown fields, bad values, bad names and too much memory", () => {
    expect(() => validateProgram({ ...base, rules: [{ when: { nope: [1] }, then: { want: 1, mood: 1 } }] })).toThrow(/unknown field/);
    expect(() => validateProgram({ ...base, rules: [{ when: { hunger: [4] }, then: { want: 1, mood: 1 } }] })).toThrow(/0\.\.3/);
    expect(() => validateProgram({ ...base, rules: [{ when: {}, then: { want: 8, mood: 1 } }] })).toThrow(/want/);
    expect(() => validateProgram({ ...base, memory: [{ name: "hunger", kind: "flag", set: [] }], rules: [] })).toThrow(/taken/);
    expect(() =>
      validateProgram({ ...base, memory: Array.from({ length: 13 }, (_, i) => ({ name: `m${i}`, kind: "counter", bits: 4 })), rules: [] }),
    ).toThrow(/48 memory bits/);
    expect(() => validateProgram({ ...base, version: "X", rules: [] })).toThrow(/version/);
  });
  it("drops a condition that allows every value", () => {
    const p = validateProgram({ ...base, rules: [{ when: { hunger: [0, 1, 2, 3], owner: [1] }, then: { want: 1, mood: 1 } }] });
    expect(p.rules[0]!.when).toEqual({ owner: [1] });
  });
});

/* ── fuzz: random programs ───────────────────────────────────────────────── */

function randomProgram(r: () => number): Program {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const memory: Array<Record<string, unknown>> = [];
  const nMem = Math.floor(r() * 5);
  const names: Array<{ name: string; bits: number }> = [];
  for (let i = 0; i < nMem; i++) {
    const kind = pick(["flag", "counter", "timer"] as const);
    const bits = kind === "flag" ? 1 : 1 + Math.floor(r() * 4);
    names.push({ name: `m${i}`, bits });
  }
  const fieldsAll = [...INPUT_FIELDS.map((f) => ({ name: f.name as string, bits: f.bits })), ...names];
  const clause = (): Clause => {
    const c: Clause = {};
    const k = 1 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) {
      const f = pick(fieldsAll);
      const max = (1 << f.bits) - 1;
      const vals = Array.from({ length: max + 1 }, (_, v) => v).filter(() => r() < 0.5);
      c[f.name] = vals.length ? vals : [Math.floor(r() * (max + 1))];
    }
    return c;
  };
  const clauses = () => Array.from({ length: Math.floor(r() * 3) }, clause);
  names.forEach((m, i) => {
    const kind = m.bits === 1 && r() < 0.5 ? "flag" : pick(["counter", "timer"] as const);
    if (kind === "flag") memory.push({ name: m.name, kind, set: clauses(), reset: clauses() });
    else if (kind === "counter") memory.push({ name: m.name, kind, bits: m.bits, inc: clauses(), dec: clauses(), reset: clauses() });
    else memory.push({ name: m.name, kind, bits: m.bits, reset: clauses(), ...(r() < 0.5 ? { count: clauses() } : {}) });
    void i;
  });
  const rules = Array.from({ length: Math.floor(r() * 12) }, () => ({
    when: clause(),
    then: { want: Math.floor(r() * 8), mood: Math.floor(r() * 4), nudge: Math.floor(r() * 8) },
  }));
  return validateProgram({
    version: "LX-PET/1",
    memory,
    rules,
    otherwise: { want: Math.floor(r() * 8), mood: Math.floor(r() * 4), nudge: Math.floor(r() * 8) },
  });
}

describe("fuzz: 300 random programs", () => {
  it("every compiled circuit equals its program on 3,000 random beats", { timeout: 60_000 }, () => {
    const r = rng(20261115);
    for (let k = 0; k < 300; k++) {
      const p = randomProgram(r);
      const net = compileProgram(p);
      const c = load(netlistBytes(net), N_IN, N_OUT);
      expect(c.nState).toBe(stateBits(p));
      const fast = fastBrain(net);
      const n = stateBits(p);
      let state = new Array(n).fill(0);
      for (let i = 0; i < 3_000; i++) {
        if (r() < 0.1) state = Array.from({ length: n }, () => (r() < 0.5 ? 1 : 0));
        const w = Math.floor(r() * (1 << N_IN));
        const want = runBeat(p, state, w);
        const st = Uint8Array.from(state);
        const out = fast.step(st, w);
        if (out !== want.out || Array.from(st).join("") !== want.state.join("")) {
          throw new Error(`program ${k} beat ${i}: ${JSON.stringify(p)}`);
        }
        if (i % 500 === 0) {
          const [ns, outs] = beat(c, state, bitsOf(w, N_IN));
          expect(wordOf(outs)).toBe(want.out);
          expect(ns).toEqual(want.state);
        }
        state = want.state;
      }
    }
  });
});
