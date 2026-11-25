/**
 * P7: the proof page's two checks, out of VerifyApp so they can be tested against a chain that agrees, one that
 * disagrees on a single input, and one that fails to answer. A starter brain is compiled for real; the chain is faked
 * from the same circuit, so "agrees" means the local replay and the chain's answer are the same function.
 */
import { describe, expect, it } from "vitest";
import { STARTER_GENTLE, beat, bitsToWord, compileProgram, encode, load, toElements, wordToBits } from "@lingxi/brain";
import { fullCheck, spotCheck } from "./checks";

const circuit = load(encode(toElements(compileProgram(STARTER_GENTLE))), 16, 8);
const bits = circuit.nState;
const saved = wordToBits(5n, bits);

/** what an honest chain answers: the same circuit, run once */
const honest = (state: bigint, word: number) => {
  const [ns, outs] = beat(circuit, wordToBits(state, bits), wordToBits(word, 16));
  return { next: bitsToWord(ns), outputs: Number(bitsToWord(outs)) };
};
const noWait = () => Promise.resolve();

describe("spotCheck (P7)", () => {
  it("asks 32 inputs, the first at the pet's saved memory, and every honest answer agrees", async () => {
    const asked: Array<[bigint, number]> = [];
    const shown: number[] = [];
    const rows = await spotCheck(
      { circuit, bits, saved },
      async (state, word) => (asked.push([state, word]), honest(state, word)),
      (r) => shown.push(r.length),
    );
    expect(rows).toHaveLength(32);
    expect(asked[0]![0]).toBe(bitsToWord(saved));
    expect(shown).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(rows.every((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs)).toBe(true);
  });

  it("shows a disagreement as a row whose chain and local answers differ", async () => {
    const rows = await spotCheck(
      { circuit, bits, saved },
      async (state, word) => {
        const a = honest(state, word);
        return word % 2 ? { ...a, outputs: a.outputs ^ 1 } : a;
      },
      () => {},
    );
    expect(rows.some((r) => r.chain.outputs !== r.local.outputs)).toBe(true);
  });
});

describe("fullCheck (P7)", () => {
  const words = 1024;

  it("every input at the saved memory agrees with an honest chain, across four workers", async () => {
    const seen = new Set<number>();
    const res = await fullCheck(
      { circuit, saved },
      async (_w, ws) => (ws.forEach((x) => seen.add(x)), ws.map((x) => honest(bitsToWord(saved), x))),
      {
        words,
        stop: () => false,
        onProgress: () => {},
        wait: noWait,
      },
    );
    expect(res).toEqual({ done: words, bad: 0 });
    expect(seen.size).toBe(words);
  });

  it("names the first input the chain disagrees on, in hex, and counts every bad one", async () => {
    const res = await fullCheck(
      { circuit, saved },
      async (_w, ws) =>
        ws.map((x) => {
          const a = honest(bitsToWord(saved), x);
          return x === 0x1a3 || x === 0x2ff ? { ...a, next: a.next ^ 1n } : a;
        }),
      { words, stop: () => false, onProgress: () => {}, wait: noWait },
    );
    expect(res.bad).toBe(2);
    expect(res.first).toBe("0x01a3");
  });

  it("asks a failing batch three times, then counts its inputs as bad rather than passing them", async () => {
    let tries = 0;
    const res = await fullCheck(
      { circuit, saved },
      async (_w, ws) => {
        if (ws[0] === 0) {
          tries++;
          throw new Error("rate limited");
        }
        return ws.map((x) => honest(bitsToWord(saved), x));
      },
      { words, stop: () => false, onProgress: () => {}, wait: noWait },
    );
    expect(tries).toBe(3);
    expect(res.bad).toBe(64);
    expect(res.first).toBe("0x0000");
  });

  it("stops when asked, with what it has checked so far", async () => {
    let calls = 0;
    const res = await fullCheck(
      { circuit, saved },
      async (_w, ws) => (calls++, ws.map((x) => honest(bitsToWord(saved), x))),
      { words, stop: () => calls >= 4, onProgress: () => {}, wait: noWait },
    );
    expect(res.done).toBeLessThan(words);
    expect(res.done % 64).toBe(0);
    expect(res.bad).toBe(0);
  });
});
