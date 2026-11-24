/**
 * A diary's hash chain off the request thread (A114). Checking a published diary folds every beat into keccak-256, and
 * a diary at the send limit takes most of a second of that on whichever thread runs it. The hashes run one at a time
 * in one long-lived worker (A145: a fresh worker for each cost about 0.4 s of start-up), each with a time budget past
 * which that worker is ended and the next hash starts a new one. A few wait, each network in one place at a time
 * (A145), so one network's junk cannot fill the line; past that a publish is answered "busy" so the owner tries again,
 * never kept unchecked.
 */
import { Worker } from "node:worker_threads";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { prefixOf } from "./limit";

/** How long one check may run, how many run at once, and how many may wait. */
export const LOG_HASH_BUDGET_MS = 5_000;
export const LOG_HASHES_AT_ONCE = 1;
export const LOG_HASHES_WAITING = 4;

/** The chain's hash of `words` from the zero hash, or null when it could not be worked out now (busy or slow). */
export type LogHasher = (words: readonly number[], who?: string) => Promise<string | null>;

/** On the calling thread: for tests and tools, never the server's request thread. */
export const hashHere: LogHasher = async (words) => chainAll(ZERO_HASH, words);

/** One worker kept for every hash, ended and started afresh only after a hash past its budget or a failure. */
function keptWorker(budgetMs: number): { run: LogHasher; started: () => number } {
  let worker: Worker | null = null;
  let started = 0;
  let next = 0;
  const waiting = new Map<number, (hash: string | null) => void>();
  const end = () => {
    const w = worker;
    worker = null;
    for (const done of waiting.values()) done(null);
    waiting.clear();
    void w?.terminate();
  };
  const ensure = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL("./logHashBoot.mjs", import.meta.url));
    // a kept worker never holds a process open by itself
    w.unref();
    started++;
    w.on("message", (m: { id?: number; hash?: string }) => {
      const done = typeof m.id === "number" ? waiting.get(m.id) : undefined;
      if (!done) return;
      waiting.delete(m.id!);
      done(typeof m.hash === "string" ? m.hash : null);
    });
    w.on("error", () => worker === w && end());
    w.on("exit", () => worker === w && end());
    worker = w;
    return w;
  };
  const run: LogHasher = (words) =>
    new Promise<string | null>((resolve) => {
      const id = ++next;
      const packed = Uint16Array.from(words);
      const timer = setTimeout(() => {
        // past its budget: this worker is ended, and the next hash starts a new one
        if (waiting.has(id)) end();
      }, budgetMs);
      waiting.set(id, (hash) => {
        clearTimeout(timer);
        resolve(hash);
      });
      ensure().postMessage({ id, words: packed }, [packed.buffer]);
    });
  return { run, started: () => started };
}

export function createLogHasher(
  opts: { budgetMs?: number; atOnce?: number; waiting?: number; run?: LogHasher } = {},
): LogHasher & { workersStarted: () => number } {
  const kept = opts.run ? null : keptWorker(opts.budgetMs ?? LOG_HASH_BUDGET_MS);
  const run = opts.run ?? kept!.run;
  const atOnce = opts.atOnce ?? LOG_HASHES_AT_ONCE;
  const room = opts.waiting ?? LOG_HASHES_WAITING;
  let running = 0;
  const queue: Array<{ network: string; go: () => void }> = [];
  const hasher = async (words: readonly number[], who = "unknown") => {
    if (running >= atOnce) {
      // a network waits in one place at a time (A145)
      const network = prefixOf(who) ?? who;
      if (queue.length >= room || queue.some((q) => q.network === network)) return null;
      await new Promise<void>((go) => queue.push({ network, go }));
    }
    running++;
    try {
      return await run(words, who);
    } finally {
      running--;
      queue.shift()?.go();
    }
  };
  return Object.assign(hasher, { workersStarted: () => kept?.started() ?? 0 });
}
