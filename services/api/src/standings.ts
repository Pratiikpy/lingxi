/**
 * A38: season standings, fought out off the request thread. Every pet in a week's season fights every other from
 * both sides; a full season of the largest honest pets takes about 4.3 s to fight (measured 2026-11-19), and on the
 * request thread that stalled every visitor while it ran. Here each set of entries is fought once, in a worker thread
 * with a time budget, and the result is kept on disk, so a restart does not fight it again. Until a set's standings
 * are known, the last ones known for that week are served, marked pending, and the game says so.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { type SeasonEntry, type Standing, standingsDigest } from "@lingxi/game";

/** How long one week's fight may take before the worker is stopped; an honest full season takes about 4.3 s. */
export const STANDINGS_BUDGET_MS = 60_000;
/** After a fight runs past its budget, how long before the same set of entries is tried again. */
const RETRY_AFTER_MS = 10 * 60_000;

/** Fights a week's entries and gives their standings. */
export type Compute = (week: string, entries: readonly SeasonEntry[]) => Promise<Standing[]>;

export interface StandingsAnswer {
  standings: Standing[];
  digest: string;
  /** the standings are not yet those of these entries: they are being fought */
  pending: boolean;
}

interface Fought {
  week: string;
  key: string;
  standings: Standing[];
  digest: string;
}

/** Keys already worked out, by the entries list itself: a week's list is replaced on every entry, never changed. */
const keys = new WeakMap<readonly SeasonEntry[], { week: string; key: string }>();

/** Which set of entries standings belong to (hashed once per list: up to 64 cards is about half a megabyte). */
export function entriesKey(week: string, entries: readonly SeasonEntry[]): string {
  const known = keys.get(entries);
  if (known?.week === week) return known.key;
  const key = createHash("sha256").update(week).update(":").update(JSON.stringify(entries)).digest("hex");
  keys.set(entries, { week, key });
  return key;
}

/** Fights in a worker thread (`standingsBoot.mjs`), stopped past `budgetMs`. */
export function workerCompute(budgetMs = STANDINGS_BUDGET_MS): Compute {
  return (week, entries) =>
    new Promise<Standing[]>((resolve, reject) => {
      const w = new Worker(new URL("./standingsBoot.mjs", import.meta.url), { workerData: { week, entries } });
      let done = false;
      const finish = (f: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void w.terminate();
        f();
      };
      const timer = setTimeout(() => finish(() => reject(new Error(`the standings for ${week} ran past their budget of ${budgetMs} ms`))), budgetMs);
      w.once("message", (m: { standings?: Standing[]; error?: string }) => finish(() => (m.standings ? resolve(m.standings) : reject(new Error(m.error ?? "the standings worker failed")))));
      w.once("error", (e) => finish(() => reject(e)));
      w.once("exit", (code) => finish(() => reject(new Error(`the standings worker stopped (${code})`))));
    });
}

export function createStandingsRunner(opts: { compute?: Compute; file?: string; budgetMs?: number; now?: () => number; log?: (m: string) => void } = {}) {
  const budgetMs = opts.budgetMs ?? STANDINGS_BUDGET_MS;
  const compute = opts.compute ?? workerCompute(budgetMs);
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => void process.stderr.write(m));
  const fought = new Map<string, Fought>();
  if (opts.file && existsSync(opts.file)) {
    try {
      for (const f of JSON.parse(readFileSync(opts.file, "utf8")) as Fought[]) if (f && typeof f.week === "string" && typeof f.key === "string" && Array.isArray(f.standings)) fought.set(f.week, f);
    } catch {
      // a damaged file is fought again, week by week, as asked
    }
  }
  const save = () => {
    if (!opts.file) return;
    mkdirSync(dirname(opts.file), { recursive: true });
    writeFileSync(`${opts.file}.tmp`, JSON.stringify([...fought.values()]));
    renameSync(`${opts.file}.tmp`, opts.file);
  };
  /** the newest set of entries waiting, per week: one that arrives later takes the place of one not yet started */
  const waiting = new Map<string, { entries: readonly SeasonEntry[]; key: string }>();
  const failed = new Map<string, number>();
  let running: string | null = null;
  const settled: Array<() => void> = [];

  const next = () => {
    if (running !== null) return;
    const [week, job] = waiting.entries().next().value ?? [];
    if (!week || !job) {
      for (const go of settled.splice(0)) go();
      return;
    }
    waiting.delete(week);
    running = job.key;
    // a fight that never settles is ended by the budget here as well as in the worker
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overBudget = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the standings for ${week} ran past their budget of ${budgetMs} ms`)), budgetMs);
    });
    void Promise.race([compute(week, job.entries), overBudget])
      .then((standings) => {
        fought.set(week, { week, key: job.key, standings, digest: standingsDigest(standings) });
        save();
      })
      .catch((e: Error) => {
        failed.set(job.key, now());
        log(`season standings: ${e.message}\n`);
      })
      .finally(() => {
        clearTimeout(timer);
        running = null;
        next();
      });
  };

  return {
    /** The standings of `entries` if fought, else the last known for the week, pending; asks for the fight. */
    get(week: string, entries: readonly SeasonEntry[]): StandingsAnswer {
      const have = fought.get(week);
      if (!entries.length) return { standings: [], digest: standingsDigest([]), pending: false };
      const key = entriesKey(week, entries);
      if (have?.key === key) return { standings: have.standings, digest: have.digest, pending: false };
      const lastFailed = failed.get(key);
      if (running !== key && waiting.get(week)?.key !== key && (lastFailed === undefined || now() - lastFailed >= RETRY_AFTER_MS)) {
        waiting.set(week, { entries, key });
        next();
      }
      return { standings: have?.standings ?? [], digest: have?.digest ?? "", pending: true };
    },
    /** Resolves once nothing is being fought or waiting (for tests and a clean stop). */
    idle(): Promise<void> {
      if (running === null && !waiting.size) return Promise.resolve();
      return new Promise((r) => settled.push(r));
    },
  };
}
export type StandingsRunner = ReturnType<typeof createStandingsRunner>;
