/**
 * The proof page's two checks of a pet's brain against X Layer (P7: out of VerifyApp, with the chain passed in so they
 * can be tested). The spot check asks 32 inputs, the first at the pet's saved memory, and shows each as it arrives.
 * The full check asks every one of the 65,536 inputs at the saved memory, in batches across four workers that each
 * start at a different public endpoint; a batch the chain never answers is asked three times and then counted as bad,
 * never as passed.
 */
import { type Circuit, beat, bitsToWord, wordToBits } from "@lingxi/brain";

/** what the chain (or the local replay) says one beat does */
export interface Answer {
  next: bigint;
  outputs: number;
}

export interface Row {
  state: bigint;
  word: number;
  chain: Answer;
  local: Answer;
}

/** one input at one memory, asked of X Layer */
export type AskOne = (state: bigint, word: number) => Promise<Answer>;
/** a batch of inputs at the saved memory, asked of X Layer by one worker (each worker has its own endpoint) */
export type AskMany = (worker: number, words: number[]) => Promise<Answer[]>;

const SPOT = 32;
const INPUTS = 65536;
const BATCH = 64;
const WORKERS = 4;
const TRIES = 3;
/** paced per host, so no public endpoint rate-limits the page */
const PACE_MS = 120;
const BACKOFF_MS = 800;

export async function spotCheck(
  pet: { circuit: Circuit; bits: number; saved: readonly number[] },
  ask: AskOne,
  onRows: (rows: Row[]) => void,
): Promise<Row[]> {
  const { circuit, bits, saved } = pet;
  const out: Row[] = [];
  for (let i = 0; i < SPOT; i++) {
    const state = i === 0 ? bitsToWord(saved) : BigInt(Math.floor(Math.random() * 2 ** Math.min(bits, 30)));
    const word = Math.floor(Math.random() * 65536);
    const chain = await ask(state, word);
    const [ns, outs] = beat(circuit, wordToBits(state, bits), wordToBits(word, 16));
    out.push({ state, word, chain, local: { next: bitsToWord(ns), outputs: Number(bitsToWord(outs)) } });
    onRows([...out]);
  }
  return out;
}

export interface FullProgress {
  done: number;
  bad: number;
  /** the first input the chain disagreed on, as 0x0000 */
  first?: string;
}

export async function fullCheck(
  pet: { circuit: Circuit; saved: readonly number[] },
  askMany: AskMany,
  opts: {
    stop: () => boolean;
    onProgress: (p: FullProgress) => void;
    /** how many inputs to ask (all 65,536 on the page; fewer in tests) */
    words?: number;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<FullProgress> {
  const { circuit, saved } = pet;
  const total = opts.words ?? INPUTS;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let next = 0;
  let done = 0;
  let bad = 0;
  let first: string | undefined;
  const progress = (): FullProgress => ({ done, bad, ...(first ? { first } : {}) });
  const worker = async (w: number) => {
    while (next < total && !opts.stop()) {
      const from = next;
      next += BATCH;
      const words = Array.from({ length: Math.min(BATCH, total - from) }, (_, k) => from + k);
      let chain: Answer[] = [];
      for (let attempt = 0; attempt < TRIES; attempt++) {
        try {
          chain = await askMany(w, words);
          await wait(PACE_MS);
          break;
        } catch {
          // a busy or failing endpoint: wait longer and ask again; after the last try the batch counts as bad below
          await wait(BACKOFF_MS * (attempt + 1));
        }
      }
      words.forEach((x, k) => {
        const [ns, outs] = beat(circuit, saved, wordToBits(x, 16));
        const c = chain[k];
        if (!c || c.next !== bitsToWord(ns) || c.outputs !== Number(bitsToWord(outs))) {
          bad++;
          first ??= `0x${x.toString(16).padStart(4, "0")}`;
        }
      });
      done += words.length;
      opts.onProgress(progress());
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
  return progress();
}
