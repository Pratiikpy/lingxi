/**
 * Season proofs off the request thread (A62). Comparing an entered mind with the circuit on X Layer compiles the mind and
 * runs both on all 65,536 inputs, from empty memory and from the pet's own: about 0.7 s for a 357-gate brain and 1.6 s
 * for a child's, on the thread that answers every request. Each check runs in a worker with a time budget; a few run at
 * once and a few wait, and past that a check is answered "busy" so the player tries again, never proven unchecked.
 */
import { Worker } from "node:worker_threads";
import type { Circuit, StarterLine } from "@lingxi/brain";
import type { PetCard } from "@lingxi/game";

/** How long one check may run, how many run at once, and how many may wait. */
export const MIND_CHECK_BUDGET_MS = 20_000;
export const MIND_CHECKS_AT_ONCE = 2;
export const MIND_CHECKS_WAITING = 8;

export type MindVerdict = "same" | "different" | "busy" | "slow";
export type MindCheck = (circuit: Circuit, line: StarterLine, card: PetCard) => Promise<MindVerdict>;

/** One check in a worker, ended at the budget. */
function inWorker(budgetMs: number): MindCheck {
  return (circuit, line, card) =>
    new Promise<MindVerdict>((resolve) => {
      const w = new Worker(new URL("./mindBoot.mjs", import.meta.url), { workerData: { circuit, line, card } });
      let done = false;
      const finish = (v: MindVerdict) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void w.terminate();
        resolve(v);
      };
      const timer = setTimeout(() => finish("slow"), budgetMs);
      // a check that could not finish says nothing about the pet: it is "slow", answered as busy, never as a mismatch
      w.once("message", (m: { same?: boolean; error?: string }) => finish(m.same === true ? "same" : m.same === false ? "different" : "slow"));
      w.once("error", () => finish("slow"));
      w.once("exit", () => finish("slow"));
    });
}

export function createMindChecker(opts: { budgetMs?: number; atOnce?: number; waiting?: number; run?: MindCheck } = {}): MindCheck {
  const run = opts.run ?? inWorker(opts.budgetMs ?? MIND_CHECK_BUDGET_MS);
  const atOnce = opts.atOnce ?? MIND_CHECKS_AT_ONCE;
  const room = opts.waiting ?? MIND_CHECKS_WAITING;
  let running = 0;
  const queue: Array<() => void> = [];
  return async (circuit, line, card) => {
    if (running >= atOnce) {
      if (queue.length >= room) return "busy";
      await new Promise<void>((go) => queue.push(go));
    }
    running++;
    try {
      return await run(circuit, line, card);
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}
