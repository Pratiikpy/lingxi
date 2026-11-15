import { describe, expect, it } from "vitest";
import vectors from "./fixtures/tap02-vectors.json";
import {
  type Circuit,
  IllFormed,
  beat,
  bytesToHex,
  decode,
  encode,
  hexToBytes,
  load,
  pack,
  refKey,
  unpack,
} from "../src/tap02";

interface RefSpec {
  cpu: string;
  id: number;
  nIn: number;
  nOut: number;
  netlist: string;
}

function resolverFor(refs: RefSpec[]) {
  const cache = new Map<string, Circuit>();
  const resolve = (cpu: string, id: bigint): Circuit | null => {
    const key = refKey(cpu, id);
    const hit = cache.get(key);
    if (hit) return hit;
    const spec = refs.find((r) => refKey(r.cpu, BigInt(r.id)) === key);
    if (!spec) return null;
    const c = load(hexToBytes(spec.netlist), spec.nIn, spec.nOut, resolve);
    cache.set(key, c);
    return c;
  };
  return resolve;
}

const hexBits = (hex: string, n: number) => unpack(hexToBytes(hex), n);
const bitsHex = (bits: number[]) => bytesToHex(pack(bits)).slice(2);

describe("TAP-02 official vectors", () => {
  for (const v of vectors.valid as Array<Record<string, unknown>>) {
    const name = v.name as string;
    it(`valid: ${name}`, () => {
      const refs = (v.refs as RefSpec[]) ?? [];
      const c = load(hexToBytes(v.netlist as string), v.nIn as number, v.nOut as number, resolverFor(refs));
      expect(c.nState).toBe(v.nState);
      // round trip through encode
      expect(bytesToHex(encode(c.elements))).toBe((v.netlist as string).toLowerCase());
      const table = v.truthTable as Array<{ inputs: string; outputs: string }> | undefined;
      for (const row of table ?? []) {
        const [, outs] = beat(c, [], hexBits(row.inputs, c.nIn));
        expect(bitsHex(outs)).toBe(row.outputs);
      }
      const beats = v.beats as Array<{ inputs: string; state: string; newState: string; outputs: string }> | undefined;
      for (const b of beats ?? []) {
        const [ns, outs] = beat(c, hexBits(b.state, c.nState), hexBits(b.inputs, c.nIn));
        expect(bitsHex(outs)).toBe(b.outputs);
        expect(bitsHex(ns)).toBe(b.newState);
      }
    });
  }

  for (const v of vectors.illFormed as Array<Record<string, unknown>>) {
    it(`ill-formed: ${v.name as string}`, () => {
      const refs = (v.refs as RefSpec[]) ?? [];
      expect(() =>
        load(hexToBytes(v.netlist as string), v.nIn as number, v.nOut as number, resolverFor(refs)),
      ).toThrow(IllFormed);
      try {
        load(hexToBytes(v.netlist as string), v.nIn as number, v.nOut as number, resolverFor(refs));
      } catch (e) {
        expect((e as Error).message).toBe(v.reason);
      }
    });
  }

  it("packing edge cases read like the deployed evaluator", () => {
    const pe = vectors.packingEdgeCases as { cases: Array<{ case: string; inputs: string; outputs: string }> };
    const nand = load(hexToBytes("0x00000002000003"), 2, 1);
    for (const c of pe.cases) {
      const [, outs] = beat(nand, [], unpack(hexToBytes(c.inputs), 2));
      expect(bitsHex(outs), c.case).toBe(c.outputs);
    }
  });

  it("decode rejects an unknown opcode", () => {
    expect(() => decode(hexToBytes("0x09"), 0)).toThrow(/unknown opcode 0x09/);
  });
});
