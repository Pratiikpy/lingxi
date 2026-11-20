/**
 * A diary's hash chain off the request thread (A114). Checking a published diary folds every beat into keccak-256, and
 * a diary at the send limit takes most of a second of that on whichever thread runs it. Each check runs in a worker
 * with a time budget; one runs at a time and a few wait, and past that the publish is answered "busy" so the owner
 * tries again, never kept unchecked.
 */
import { Worker } from "node:worker_threads";
import { ZERO_HASH, chainAll } from "@lingxi/game";

/** How long one check may run, how many run at once, and how many may wait. */
export const LOG_HASH_BUDGET_MS = 5_000;
export const LOG_HASHES_AT_ONCE = 1;
export const LOG_HASHES_WAITING = 4;

/** The chain's hash of `words` from the zero hash, or null when it could not be worked out now (busy or slow). */
export type LogHasher = (words: readonly number[]) => Promise<string | null>;

/** On the calling thread: for tests and tools, never the server's request thread. */
export const hashHere: LogHasher = async (words) => chainAll(ZERO_HASH, words);

/** One hash in a worker, ended at the budget. */
function inWorker(budgetMs: number): LogHasher {
  return (words) =>
    new Promise<string | null>((resolve) => {
      const packed = Uint16Array.from(words);
      const w = new Worker(new URL("./logHashBoot.mjs", import.meta.url), { workerData: { words: packed }, transferList: [packed.buffer] });
      let done = false;
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void w.terminate();
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), budgetMs);
      w.once("message", (m: { hash?: string }) => finish(typeof m.hash === "string" ? m.hash : null));
      w.once("error", () => finish(null));
      w.once("exit", () => finish(null));
    });
}

export function createLogHasher(opts: { budgetMs?: number; atOnce?: number; waiting?: number; run?: LogHasher } = {}): LogHasher {
  const run = opts.run ?? inWorker(opts.budgetMs ?? LOG_HASH_BUDGET_MS);
  const atOnce = opts.atOnce ?? LOG_HASHES_AT_ONCE;
  const room = opts.waiting ?? LOG_HASHES_WAITING;
  let running = 0;
  const queue: Array<() => void> = [];
  return async (words) => {
    if (running >= atOnce) {
      if (queue.length >= room) return null;
      await new Promise<void>((go) => queue.push(go));
    }
    running++;
    try {
      return await run(words);
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}
