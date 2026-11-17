/**
 * The handheld's C core against the game's own code: keccak, the log chain and the TAP-02 evaluator.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { type Circuit, STARTERS, beat, compileProgram, compileSeal, composeChild, composeInstinct, fastBrain, load, netlistBytes, refKey, ruleNetlist, wordToBits } from "@lingxi/brain";
import { EVOLUTION, ZERO_HASH, chainAll, chainLog } from "@lingxi/game";
import { RULES } from "@lingxi/chain";
import { type HandheldCore, circuitBlob } from "../src/core";
import { PROCESSOR, STARTER_ID, loadCore, rng, root, sha256 } from "./helpers";

const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const hexBytes = (h: string) => Uint8Array.from({ length: (h.length - 2) / 2 }, (_, i) => parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16));

describe("the committed WebAssembly module", () => {
  it("were built from the sources as they are now", () => {
    for (const target of ["core", "app"]) {
      const rec = JSON.parse(readFileSync(`${root}/wasm/build-${target}.json`, "utf8")) as { module: { path: string; sha256: string }; sources: Record<string, string>; headers: Record<string, string> };
      expect(sha256(readFileSync(`${root}/${rec.module.path}`)), target).toBe(rec.module.sha256);
      for (const [f, h] of Object.entries({ ...rec.sources, ...rec.headers })) expect(sha256(readFileSync(`${root}/${f}`)), `${f} changed since the ${target} module was built: run pnpm build:wasm`).toBe(h);
    }
  });
});

describe("keccak-256 and the log chain", () => {
  it("equal @noble/hashes on every length from 0 to 600 bytes", async () => {
    const core = await loadCore();
    const r = rng(7);
    for (let n = 0; n <= 600; n++) {
      const b = Uint8Array.from({ length: n }, () => r.int(256));
      expect(core.keccak(b), `length ${n}`).toBe(hex(keccak_256(b)));
    }
  });

  it("chain words exactly as PetRegistry.chainLog does", async () => {
    const core = await loadCore();
    const r = rng(11);
    let h = ZERO_HASH;
    for (let i = 0; i < 400; i++) {
      const w = r.int(0x10000);
      const got = core.chain(hexBytes(h), w);
      h = chainLog(h, w);
      expect(got).toBe(h);
    }
  });

  it("reproduce pet #1's saved mainnet log hash and memory", async () => {
    const core = await loadCore();
    const log = JSON.parse(readFileSync(`${root}/../chain/deployments/pet-1-log.json`, "utf8")) as { segments: Array<{ brainId: string; words: number[] }> };
    const words = log.segments.flatMap((s) => s.words);
    let h = hexBytes(ZERO_HASH);
    for (const w of words) h = hexBytes(core.chain(h, w));
    expect(hex(h)).toBe(chainAll(ZERO_HASH, words));
    // and the gentle brain's memory after those words, through the core's evaluator
    const n = compileProgram(STARTERS.gentle);
    expect(core.loadCircuit(circuitBlob(netlistBytes(n), 16, 8))).toBe("ok");
    const fast = fastBrain(n);
    let st = new Uint8Array(n.latches.length);
    const ref = new Uint8Array(n.latches.length);
    for (const w of words) {
      st = core.beat(st, Uint8Array.from(wordToBits(w, 16))).state as Uint8Array<ArrayBuffer>;
      fast.step(ref, w);
    }
    expect(Array.from(st)).toEqual(Array.from(ref));
  });
});

/** compare the core with the reference evaluator on every input word and a set of states */
function sweep(core: HandheldCore, c: Circuit, states: number[][], label: string): void {
  const nIn = c.nIn;
  for (const s of states) {
    for (let w = 0; w < 1 << nIn; w++) {
      const inputs = wordToBits(w, nIn);
      const [ns, outs] = beat(c, s, inputs);
      const got = core.beat(Uint8Array.from(s), Uint8Array.from(inputs));
      if (Array.from(got.outputs).join() !== outs.join() || Array.from(got.state).join() !== ns.join()) {
        throw new Error(`${label}: differs at input ${w}, state ${s.join("")}`);
      }
    }
  }
}

const someStates = (n: number, seed: number, k: number): number[][] => {
  const r = rng(seed);
  const out = [new Array(n).fill(0), new Array(n).fill(1)];
  while (out.length < k) out.push(Array.from({ length: n }, () => r.int(2)));
  return out;
};

describe("the TAP-02 evaluator", () => {
  it("equals packages/brain on every input of the three starter brains, from 6 states each", async () => {
    const core = await loadCore();
    for (const line of ["gentle", "bold", "curious"] as const) {
      const bytes = netlistBytes(compileProgram(STARTERS[line]));
      const c = load(bytes, 16, 8);
      expect(core.loadCircuit(circuitBlob(bytes, 16, 8))).toBe("ok");
      expect(core.shape()).toEqual({ nIn: 16, nOut: 8, nState: c.nState, nGates: c.nGates });
      sweep(core, c, someStates(c.nState, 3, 6), line);
    }
  }, 600_000);

  it("equals the fast evaluator on every input word and every memory state of the gentle brain", async () => {
    const core = await loadCore();
    const n = compileProgram(STARTERS.gentle);
    const fast = fastBrain(n);
    expect(core.loadCircuit(circuitBlob(netlistBytes(n), 16, 8))).toBe("ok");
    const nState = n.latches.length;
    for (let s = 0; s < 1 << nState; s++) {
      const state = Uint8Array.from(wordToBits(s, nState));
      for (let w = 0; w < 1 << 16; w++) {
        const ref = state.slice();
        const out = fast.step(ref, w);
        const got = core.beat(state, Uint8Array.from(wordToBits(w, 16)));
        let o = 0;
        for (let i = 0; i < 8; i++) o |= got.outputs[i]! << i;
        if (o !== out || Array.from(got.state).join() !== Array.from(ref).join()) throw new Error(`differs at state ${s}, input ${w}`);
      }
    }
  }, 1_200_000);

  it("equals packages/brain on the evolution and seal circuits and all 17 rule circuits", async () => {
    const core = await loadCore();
    const circuits: Array<[string, Uint8Array, number, number]> = [];
    const evo = compileProgram(EVOLUTION);
    circuits.push(["evolution", netlistBytes(evo), evo.nIn, evo.nOut]);
    const seal = compileSeal();
    circuits.push(["seal", netlistBytes(seal), seal.nIn, seal.nOut]);
    for (const rule of RULES) {
      const n = ruleNetlist(rule);
      circuits.push([rule.name, netlistBytes(n), n.nIn, n.nOut]);
    }
    expect(circuits.length).toBe(19);
    for (const [name, bytes, nIn, nOut] of circuits) {
      const c = load(bytes, nIn, nOut);
      expect(core.loadCircuit(circuitBlob(bytes, nIn, nOut)), name).toBe("ok");
      sweep(core, c, someStates(c.nState, 5, c.nState ? 3 : 1), name);
    }
  }, 600_000);

  it("runs composed children and instincts, REFs and all, as packages/brain does", async () => {
    const core = await loadCore();
    const lines = ["gentle", "bold", "curious"] as const;
    const parts = lines.map((l) => ({ processor: PROCESSOR, id: STARTER_ID[l], nIn: 16, nOut: 8, bytes: netlistBytes(compileProgram(STARTERS[l])) }));
    const subs = new Map<string, Circuit>(parts.map((q) => [refKey(q.processor, q.id), load(q.bytes, 16, 8)]));
    const resolve = (cpu: string, id: bigint) => subs.get(refKey(cpu, id));
    const pairs: Array<[string, Uint8Array]> = [
      ["gentle x bold", composeChild({ cpu: PROCESSOR, id: 1n }, { cpu: PROCESSOR, id: 2n }).bytes],
      ["curious x gentle", composeChild({ cpu: PROCESSOR, id: 3n }, { cpu: PROCESSOR, id: 1n }).bytes],
      ["bold with a curious instinct", composeInstinct({ cpu: PROCESSOR, id: 2n }, { cpu: PROCESSOR, id: 3n }).bytes],
    ];
    for (const [name, bytes] of pairs) {
      const c = load(bytes, 16, 8, resolve);
      expect(core.loadCircuit(circuitBlob(bytes, 16, 8, parts)), name).toBe("ok");
      expect(core.shape().nState, name).toBe(c.nState);
      sweep(core, c, someStates(c.nState, 9, 3), name);
    }
  }, 600_000);

  it("refuses what packages/brain refuses, and never runs it", async () => {
    const core = await loadCore();
    const good = netlistBytes(compileProgram(STARTERS.gentle));
    const forward = Uint8Array.from([0x00, 0, 0, 2, 0, 0, 30, 0x00, 0, 0, 2, 0, 0, 3]); // a NAND reading a later signal
    const child = composeChild({ cpu: PROCESSOR, id: 1n }, { cpu: PROCESSOR, id: 2n }).bytes;
    const gentlePart = { processor: PROCESSOR, id: 1n, nIn: 16, nOut: 8, bytes: good };
    const cases: Array<[string, Uint8Array, number, number, Parameters<typeof circuitBlob>[3], string]> = [
      ["truncated", good.subarray(0, good.length - 2), 16, 8, [], "truncated"],
      ["unknown opcode", Uint8Array.from([0x07, 0, 0, 0]), 16, 8, [], "badOpcode"],
      ["a signal not yet available", forward, 16, 1, [], "badSignal"],
      ["more outputs than signals", Uint8Array.from([0x00, 0, 0, 2, 0, 0, 3]), 16, 8, [], "badShape"],
      ["a REF with no circuit handed over", child, 16, 8, [gentlePart], "noTarget"],
      ["a REF whose pins differ", child, 16, 8, [gentlePart, { ...gentlePart, id: 2n, nOut: 7 }], "badArity"],
    ];
    for (const [name, bytes, nIn, nOut, parts, want] of cases) {
      expect(core.loadCircuit(circuitBlob(bytes, nIn, nOut, parts)), name).toBe(want);
      expect(() => load(bytes, nIn, nOut, (cpu, id) => (parts ?? []).filter((q) => refKey(q.processor, q.id) === refKey(cpu, id) && q.nOut === 8).map((q) => load(q.bytes, 16, 8))[0]), name).toThrow();
    }
  });
});
