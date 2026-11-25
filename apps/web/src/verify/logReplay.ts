/**
 * Replaying a pet's log against X Layer (P7: out of VerifyApp, with the chain passed in so every outcome can be
 * tested). The log's words must hash to the log hash the pet keeps on chain; every brain it names is anchored to the
 * pet's own Hatched and BrainChanged events (the indexer only says which transactions to read); the replay starts from
 * the memory in its Hatched event and must end at the memory the pet saved. The outcome is returned as what happened;
 * the page words it in the reader's language.
 */
import { type Circuit, beat, circuitBrain, wordToBits } from "@lingxi/brain";
import { type AnchorFailure, type AnchorHints, type AnchorResult, BrainTooBigError } from "@lingxi/chain";
import { ZERO_HASH, chainAll, unpackState } from "@lingxi/game";
import type { Hex } from "viem";

export interface LogFile {
  words: number[];
  segments?: Array<{ brainId: string | null; words: number[] }>;
}

/** a stretch of the log with the brain that lived it, for the diary to replay */
export interface Stretch {
  brain: { fast: ReturnType<typeof circuitBrain>; nState: number };
  words: number[];
}

export type LogOutcome =
  | { kind: "ok"; stretches: Stretch[]; beats: number; hatchTx: Hex; changes: number }
  /** the log runs from the pet's birth in the browser, before it was kept (A66) */
  | { kind: "birth"; beats: number }
  | { kind: "badHash" }
  | { kind: "noHints" }
  | { kind: "notAnchored"; reason: AnchorFailure; detail: string }
  | { kind: "badState" }
  | { kind: "tooBig"; gates: number; max: number }
  | { kind: "notLog" }
  | { kind: "unread" };

/** A file read as a log, or null when it is not one: said as such, never as a hash that does not match (A57). */
export function parseLog(text: string): LogFile | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    // not JSON at all: not a log, which the caller says to the reader
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const log = j as Partial<LogFile>;
  return Array.isArray(log.words) || Array.isArray(log.segments) ? (log as LogFile) : null;
}

export interface LogChain {
  /** the indexer's record of the pet: which transactions hatched it and changed its brain */
  history: () => Promise<{ hatched?: { tx: string } | null; brains: Array<{ tx: string }> } | null>;
  /** the named brains anchored to the pet's own events on X Layer */
  anchor: (brains: bigint[], hints: AnchorHints) => Promise<AnchorResult>;
  /** a brain's circuit, read from X Layer */
  circuitOf: (brainId: bigint) => Promise<Circuit>;
}

export async function replayLogOnChain(
  pet: { brainId: bigint; brainBits: number; state: bigint; logHash: string },
  log: LogFile,
  chain: LogChain,
): Promise<LogOutcome> {
  try {
    const clean = (ws: number[]) => ws.filter((w) => Number.isInteger(w) && w >= 0 && w < 65536);
    const segments = (
      log.segments?.length
        ? log.segments.map((sg) => ({ brainId: sg.brainId, words: clean(sg.words) }))
        : [{ brainId: pet.brainId.toString(), words: clean(log.words) }]
    ).filter((sg) => sg.words.length);
    const words = segments.flatMap((sg) => sg.words);
    if (chainAll(ZERO_HASH, words).toLowerCase() !== pet.logHash.toLowerCase()) return { kind: "badHash" };

    const brains = segments.map((sg) => BigInt(sg.brainId ?? pet.brainId.toString()));
    // an indexer that does not answer leaves nothing to anchor to: said as no hatching known, never as a failure
    const hints = await chain.history().catch(() => null);
    if (!hints?.hatched) return { kind: "noHints" };
    const anchored = await chain.anchor(brains.length ? brains : [pet.brainId], {
      hatched: hints.hatched.tx as Hex,
      changes: hints.brains.map((b) => b.tx as Hex),
    });
    if (!anchored.ok) return { kind: "notAnchored", reason: anchored.reason, detail: anchored.detail };

    const circuits: Circuit[] = [];
    for (const sg of segments) circuits.push(await chain.circuitOf(BigInt(sg.brainId ?? pet.brainId.toString())));
    /** the log replayed stretch by stretch from the memory `first` gives the first circuit */
    const replayed = (first: (nState: number) => number[]): number[] | null => {
      let st: number[] | null = null;
      segments.forEach((sg, i) => {
        const c = circuits[i]!;
        st =
          st === null
            ? first(c.nState)
            : st.length === c.nState
              ? st
              : st.slice(0, c.nState).concat(new Array(Math.max(0, c.nState - st.length)).fill(0));
        for (const w of sg.words) st = beat(c, st, wordToBits(w, 16))[0];
      });
      return st;
    };
    const stretches = segments.map((sg, i) => ({
      brain: { fast: circuitBrain(circuits[i]!), nState: circuits[i]!.nState },
      words: sg.words,
    }));
    // the starting memory is the one the pet hatched with, from its Hatched event
    const end =
      replayed((m) => unpackState(anchored.startState, m).brain) ??
      unpackState(anchored.startState, pet.brainBits).brain;
    const saved = unpackState(pet.state, pet.brainBits).brain;
    if (end.join("") !== saved.join("")) {
      // a pet kept after living in the browser, before its log started at the kept state: said as what it is (A66)
      const fromBirth = replayed((m) => new Array(m).fill(0));
      if (fromBirth && fromBirth.join("") === saved.join("")) return { kind: "birth", beats: words.length };
      return { kind: "badState" };
    }
    return {
      kind: "ok",
      stretches,
      beats: words.length,
      hatchTx: anchored.anchors[0]!.tx,
      changes: anchored.anchors.length - 1,
    };
  } catch (e) {
    // a brain past any pet's mind is said as such (A38), a log that names no real circuit is not a log, and any other
    // failure came from reading X Layer: none of them is a hash that does not match (A57)
    return e instanceof BrainTooBigError
      ? { kind: "tooBig", gates: e.gates, max: e.max }
      : e instanceof SyntaxError
        ? { kind: "notLog" }
        : { kind: "unread" };
  }
}
