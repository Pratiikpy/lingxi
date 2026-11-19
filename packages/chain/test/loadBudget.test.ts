/**
 * A38: a brain loaded from the chain to be run (the proof page, the battle check, the season proof) is read circuit by
 * circuit, each distinct circuit once, and refused before it is run when it would expand past what an honest pet's
 * whole mind can (`MAX_RUN_GATES`). Anyone can point a pet at any circuit on the processor with `setBrain`, so the
 * chain is no more trusted than a card.
 */
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { NAND, REF, encode, type Element } from "@lingxi/brain";
import { MAX_RUN_GATES } from "@lingxi/game";
import { BrainTooBigError, loadCircuitFromChain } from "../src/registry";

const CPU = "0x00000000000000000000000000000000000000cc" as const;
const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

/** A processor whose circuits are given here, counting the reads each circuit takes. */
function processor(circuits: Record<string, { nIn: number; nOut: number; els: Element[] }>) {
  const reads = new Map<string, number>();
  const pub = {
    readContract: async ({ functionName, args }: { functionName: string; args: [bigint] }) => {
      const c = circuits[args[0].toString()];
      if (!c) throw new Error("no circuit");
      if (functionName === "netlist") {
        reads.set(args[0].toString(), (reads.get(args[0].toString()) ?? 0) + 1);
        return toHex(encode(c.els));
      }
      return [BigInt(c.nIn), BigInt(c.nOut), 0n, 0n];
    },
  } as unknown as PublicClient;
  return { pub, reads };
}

const refs = (n: number, nIn: number, to: number): Element[] => Array.from({ length: n }, (_, i) => ({ op: REF, ins: [2], cpu: CPU, id: BigInt(to), nOut: 1, firstOut: 2 + nIn + i }) as Element);
const leaf = { nIn: 1, nOut: 1, els: [{ op: NAND, ins: [2, 2], nOut: 1, firstOut: 3 } as Element] };

describe("a brain loaded from the chain to be run (A38)", () => {
  it("reads each distinct circuit once, however many paths lead to it", async () => {
    // a diamond: the top REFs 2 and 3, both REF 4, which REFs the leaf 5
    const { pub, reads } = processor({
      "1": { nIn: 16, nOut: 8, els: [...refs(4, 16, 2), ...refs(4, 16, 3).map((e, i) => ({ ...e, firstOut: 22 + i }))] },
      "2": { nIn: 1, nOut: 1, els: refs(1, 1, 4) },
      "3": { nIn: 1, nOut: 1, els: refs(1, 1, 4) },
      "4": { nIn: 1, nOut: 1, els: refs(2, 1, 5) },
      "5": leaf,
    });
    const c = await loadCircuitFromChain(pub, CPU, 1n);
    expect(c.nGates).toBe(16);
    expect([...reads.values()].every((n) => n === 1), JSON.stringify([...reads])).toBe(true);
  });

  it("refuses a brain that would expand past an honest pet's whole mind, before it is run, and says how big", async () => {
    // four levels of 8 REFs down to one gate: 8^4 = 4,096 is fine; 12^4 = 20,736 runs past the budget
    const nest = (k: number) => {
      const out: Record<string, { nIn: number; nOut: number; els: Element[] }> = { "1": { nIn: 16, nOut: 8, els: refs(k, 16, 2) } };
      for (let lvl = 2; lvl <= 4; lvl++) out[String(lvl)] = { nIn: 1, nOut: 1, els: refs(k, 1, lvl + 1) };
      out["5"] = leaf;
      return out;
    };
    expect(8 ** 4).toBeLessThan(MAX_RUN_GATES);
    expect((await loadCircuitFromChain(processor(nest(8)).pub, CPU, 1n)).nGates).toBe(8 ** 4);
    expect(12 ** 4).toBeGreaterThan(MAX_RUN_GATES);
    const err = await loadCircuitFromChain(processor(nest(12)).pub, CPU, 1n).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrainTooBigError);
    expect((err as BrainTooBigError).gates).toBeGreaterThan(MAX_RUN_GATES);
  });
});
