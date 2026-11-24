/**
 * Recomputing the season in the player's browser (A84), in a worker so the page keeps answering while every bout is
 * refought. Where a browser cannot run the worker (none, or it fails to load), the table is still refought, here, rather
 * than the check not being offered: the answer is the same, only slower to give.
 */
import { type SeasonEntry, seasonStandings, standingsDigest } from "@lingxi/game";

export interface RefightJob {
  week: string;
  entries: readonly SeasonEntry[];
}

/** What the recompute needs of a worker (a browser's Worker, or a stand-in in tests). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(m: unknown): void;
  terminate(): void;
}

/** The table's fingerprint, refought on this thread. */
export const fingerprintHere = (job: RefightJob): string => standingsDigest(seasonStandings(job.week, job.entries));

const browserWorker = (): WorkerLike | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./seasonWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
};

/** Refights `job`; `done` gives the fingerprint, and `stop` ends the work (its `done` then rejects as stopped). */
export function refight(
  job: RefightJob,
  makeWorker: () => WorkerLike | null = browserWorker,
): { done: Promise<string>; stop: () => void } {
  let stop = () => {};
  const done = new Promise<string>((resolve, reject) => {
    const worker = makeWorker();
    let over = false;
    const finish = (f: () => void) => {
      if (over) return;
      over = true;
      worker?.terminate();
      f();
    };
    stop = () => finish(() => reject(new Error("stopped")));
    // here, a moment later, so a stop can still come first
    const here = () => setTimeout(() => finish(() => resolve(fingerprintHere(job))), 0);
    if (!worker) return here();
    worker.onmessage = (e) => {
      const digest = (e.data as { digest?: unknown } | null)?.digest;
      if (typeof digest === "string") finish(() => resolve(digest));
      else here();
    };
    worker.onerror = () => here();
    worker.postMessage({ week: job.week, entries: job.entries });
  });
  return { done, stop: () => stop() };
}
