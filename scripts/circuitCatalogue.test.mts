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
  rules: Array<{ name: string; id: string; nIn: number; inBits: number; netlistKeccak: string; vectors: Array<[number, number]> }>;
  brains: Array<{ line: "gentle" | "bold" | "curious"; id: string; nState: number; netlistKeccak: string; vectors: Array<{ input: number; output: number; nextState: number }> }>;
};
const d = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as { processor: string; rules: Record<string, { id: string }>; circuits: Record<string, { id: string }> };

describe("the circuit catalogue (H6)", () => {
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
    }
  });
});
