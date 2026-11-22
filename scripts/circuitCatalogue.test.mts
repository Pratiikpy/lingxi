/**
 * H6: the published circuit catalogue is what this repository's circuits are. Every rule and starter brain is listed with
 * its id from the deployment record and its netlist's hash, and every test vector is the answer the game's own reference
 * gives (the generator also checks each one on X Layer before writing; this keeps a stale catalogue from passing).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { STARTERS, beat, bitsToWord, compileProgram, load, netlistBytes, ruleBytes, stateBits, wordToBits } from "@lingxi/brain";
import { RULES } from "@lingxi/chain";

const root = join(import.meta.dirname, "..");
const cat = JSON.parse(readFileSync(join(root, "apps/web/public/circuits.json"), "utf8")) as {
  processor: string;
  encoding: Record<string, string>;
  encodingZh: Record<string, string>;
  brainPins: unknown;
  rules: Array<{ name: string; id: string; nIn: number; inBits: number; netlistKeccak: string; fields: unknown; vectors: Array<[number, number]> }>;
  brains: Array<{ line: "gentle" | "bold" | "curious"; id: string; nState: number; netlistKeccak: string; vectors: Array<{ input: number; output: number; nextState: number }>; walk: Array<{ state: number; input: number; output: number; nextState: number }> }>;
};
const d = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as { processor: string; rules: Record<string, { id: string }>; circuits: Record<string, { id: string }> };

describe("the circuit catalogue (H6)", () => {
  it("says how to call a circuit and what each pin means in Chinese too, beside the English (C5)", () => {
    const encoding = cat.encoding as Record<string, string>;
    const encodingZh = cat.encodingZh as Record<string, string>;
    expect(Object.keys(encodingZh).sort()).toEqual(Object.keys(encoding).sort());
    for (const v of Object.values(encodingZh)) expect(v).toMatch(/[一-鿿]/);
    const pins = cat.brainPins as { inputs: Array<{ name: string; values: string[]; nameZh: string; valuesZh: string[] }>; outputs: Array<{ name: string; values: string[]; nameZh: string; valuesZh: string[] }> };
    for (const p of [...pins.inputs, ...pins.outputs]) {
      expect(p.nameZh, p.name).toMatch(/[一-鿿]/);
      expect(p.valuesZh.length, p.name).toBe(p.values.length);
      for (const v of p.valuesZh) expect(v, p.name).toMatch(/[一-鿿]/);
    }
  });

  it("lists every rule circuit with its id, its netlist's hash and the reference's answers", () => {
    expect(cat.processor).toBe(d.processor);
    expect(cat.rules.map((r) => r.name)).toEqual(RULES.map((r) => r.name));
    for (const rule of RULES) {
      const r = cat.rules.find((x) => x.name === rule.name)!;
      expect(r.id, rule.name).toBe(d.rules[rule.name]!.id);
      expect(r.nIn).toBe(16);
      expect(r.netlistKeccak, rule.name).toBe(keccak256(ruleBytes(rule)));
      for (const [i, out] of r.vectors) expect(out, `${rule.name} ${i}`).toBe(rule.reference(i));
    }
  });

  it("says what every bit means: a rule's input fields cover exactly its input bits, its answer fields fit in 8, none overlap", () => {
    const covers = (fields: ReadonlyArray<{ lo: number; bits: number }>) => {
      const bits = fields.flatMap((f) => Array.from({ length: f.bits }, (_, k) => f.lo + k));
      return { bits: [...bits].sort((x, y) => x - y), unique: new Set(bits).size === bits.length };
    };
    for (const rule of RULES) {
      const inp = covers(rule.fields.inputs);
      expect(inp.unique, `${rule.name} inputs overlap`).toBe(true);
      expect(inp.bits, `${rule.name} inputs cover its ${rule.inBits} bits`).toEqual(Array.from({ length: rule.inBits }, (_, k) => k));
      const out = covers(rule.fields.outputs);
      expect(out.unique, `${rule.name} outputs overlap`).toBe(true);
      expect(Math.max(...out.bits), `${rule.name} outputs fit a byte`).toBeLessThan(8);
      // every answer the rule gives lives in its declared answer bits
      const used = out.bits.reduce((m, b) => m | (1 << b), 0);
      for (let w = 0; w < 2 ** rule.inBits; w++) expect(rule.reference(w) & ~used, `${rule.name} ${w}`).toBe(0);
      expect(cat.rules.find((r) => r.name === rule.name)?.fields).toEqual(JSON.parse(JSON.stringify(rule.fields)));
    }
  });

  it("lists each starter brain with its id, its netlist's hash and what it does from a fresh memory", () => {
    for (const b of cat.brains) {
      const bytes = netlistBytes(compileProgram(STARTERS[b.line]));
      expect(b.id).toBe(d.circuits[b.line]!.id);
      expect(b.netlistKeccak).toBe(keccak256(bytes));
      expect(b.nState).toBe(stateBits(STARTERS[b.line]));
      const circuit = load(bytes, 16, 8);
      for (const v of b.vectors) {
        const [next, outs] = beat(circuit, new Array<number>(b.nState).fill(0), wordToBits(v.input, 16));
        expect([Number(bitsToWord(outs)), Number(bitsToWord(next))], `${b.line} ${v.input}`).toEqual([v.output, v.nextState]);
      }
      // the walk carries memory: each beat starts where the last one left it, and some leave it not zero
      expect(b.walk.some((v) => v.state !== 0), `${b.line}'s walk reaches a memory that is not zero`).toBe(true);
      b.walk.forEach((v, k) => {
        if (k > 0) expect(v.state, `${b.line} beat ${k}`).toBe(b.walk[k - 1]!.nextState);
        const [next, outs] = beat(circuit, wordToBits(v.state, b.nState), wordToBits(v.input, 16));
        expect([Number(bitsToWord(outs)), Number(bitsToWord(next))], `${b.line} beat ${k}`).toEqual([v.output, v.nextState]);
      });
    }
  });
});
