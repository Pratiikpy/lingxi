/**
 * P7: replaying a pet's log against X Layer, out of VerifyApp so each outcome can be checked on its own. A starter brain
 * is compiled for real and the log is replayed through it; the chain's answers (the indexer's hints, the anchoring of
 * the brains to the pet's own events, the circuits) are passed in, so every way the check can end is reached here.
 */
import { describe, expect, it } from "vitest";
import { STARTER_GENTLE, beat, compileProgram, encode, load, toElements, wordToBits } from "@lingxi/brain";
import { type AnchorResult, BrainTooBigError } from "@lingxi/chain";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { parseLog, replayLogOnChain } from "./logReplay";

const circuit = load(encode(toElements(compileProgram(STARTER_GENTLE))), 16, 8);
const n = circuit.nState;
const words = [1, 2, 300, 4096];

/** a state word whose brain bits are `brain` (bit i of the word is brain bit i) and nothing else */
const stateOf = (brain: readonly number[]) => brain.reduce((w, b, i) => (b ? w | (1n << BigInt(i)) : w), 0n);
const run = (from: number[]) => words.reduce((st, w) => beat(circuit, st, wordToBits(w, 16))[0], from);
const hatchedWith = new Array(n).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0));

const pet = {
  id: 7n,
  brainId: 42n,
  brainBits: n,
  state: stateOf(run(hatchedWith)),
  logHash: chainAll(ZERO_HASH, words),
};
const HATCH = `0x${"ab".repeat(32)}` as const;
const anchoredAt = (startState: bigint): AnchorResult => ({
  ok: true,
  anchors: [{ brainId: 42n, tx: HATCH, block: 1n, kind: "hatched" }],
  startState,
});
const chain = {
  history: async () => ({ hatched: { tx: HATCH }, brains: [] }),
  anchor: async () => anchoredAt(stateOf(hatchedWith)),
  circuitOf: async () => circuit,
};

describe("parseLog (P7)", () => {
  it("reads a log of words, or of segments", () => {
    expect(parseLog(JSON.stringify({ words }))).toEqual({ words });
    expect(parseLog(JSON.stringify({ segments: [{ brainId: "42", words }] }))?.segments).toHaveLength(1);
  });
  it("a file that is not a log is no log (A57)", () => {
    for (const text of ["not json", "null", "{}", '{"words":5}', "[1,2]"]) expect(parseLog(text)).toBeNull();
  });
});

describe("replayLogOnChain (P7)", () => {
  it("a log that hashes to the pet's, anchored and replayed from its hatching memory, passes", async () => {
    const out = await replayLogOnChain(pet, { words }, chain);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.beats).toBe(words.length);
    expect(out.hatchTx).toBe(HATCH);
    expect(out.changes).toBe(0);
    expect(out.stretches).toHaveLength(1);
    expect(out.stretches[0]!.words).toEqual(words);
  });

  it("a log whose words do not hash to the pet's is a mismatch, and nothing is asked of X Layer", async () => {
    let asked = false;
    const out = await replayLogOnChain(
      pet,
      { words: [...words, 5] },
      { ...chain, history: async () => ((asked = true), null) },
    );
    expect(out.kind).toBe("badHash");
    expect(asked).toBe(false);
  });

  it("words outside 0..65535 are dropped before the hash, as the game never logs them", async () => {
    const out = await replayLogOnChain(pet, { words: [...words, -1, 70000, 1.5] }, chain);
    expect(out.kind).toBe("ok");
  });

  it("no hatching known to the indexer, or the indexer not answering, is said as such", async () => {
    expect((await replayLogOnChain(pet, { words }, { ...chain, history: async () => null })).kind).toBe("noHints");
    const down = await replayLogOnChain(
      pet,
      { words },
      {
        ...chain,
        history: async () => {
          throw new Error("indexer down");
        },
      },
    );
    expect(down.kind).toBe("noHints");
  });

  it("brains the chain does not anchor to the pet's events carry the reason and its detail", async () => {
    const out = await replayLogOnChain(
      pet,
      { words },
      {
        ...chain,
        anchor: async () => ({ ok: false, reason: "skipsChange", detail: "brain 9 never set" }),
      },
    );
    expect(out).toEqual({ kind: "notAnchored", reason: "skipsChange", detail: "brain 9 never set" });
  });

  it("a log that ends somewhere other than the pet's saved memory is a wrong state", async () => {
    const out = await replayLogOnChain(
      pet,
      { words },
      { ...chain, anchor: async () => anchoredAt(stateOf(new Array(n).fill(1))) },
    );
    expect(out.kind).toBe("badState");
  });

  it("a log that only lands when replayed from a newborn's memory is told as one that runs from birth (A66)", async () => {
    const fromBirth = { ...pet, state: stateOf(run(new Array(n).fill(0))) };
    const out = await replayLogOnChain(fromBirth, { words }, chain);
    expect(out).toEqual({ kind: "birth", beats: words.length });
  });

  it("a brain past any pet's mind, a log naming no real circuit, and a chain that cannot be read are each said as what they are", async () => {
    const failing = (e: Error) => ({
      ...chain,
      circuitOf: async () => {
        throw e;
      },
    });
    expect(await replayLogOnChain(pet, { words }, failing(new BrainTooBigError(9000, 4096)))).toEqual({
      kind: "tooBig",
      gates: 9000,
      max: 4096,
    });
    expect((await replayLogOnChain(pet, { words }, failing(new SyntaxError("bad circuit")))).kind).toBe("notLog");
    expect((await replayLogOnChain(pet, { words }, failing(new Error("timeout")))).kind).toBe("unread");
  });
});
