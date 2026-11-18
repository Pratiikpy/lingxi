/**
 * Every timer and loop the server runs. A job's error is caught, logged and kept for the health page; it never
 * reaches the process (an unguarded `void pusher.tick()` rejection took the server down 43 times). A job never
 * overlaps its own previous run, and one that fails three times in a row is reported unhealthy until it succeeds.
 */

export interface JobStatus {
  name: string;
  runs: number;
  failures: number;
  failuresInARow: number;
  healthy: boolean;
  running: boolean;
  lastOk?: number;
  lastError?: { at: number; message: string };
}

const UNHEALTHY_AFTER = 3;

export function createJobs(log: (line: string) => void = (s) => process.stderr.write(s)) {
  const state = new Map<string, JobStatus>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  async function run(name: string, fn: () => unknown): Promise<void> {
    const s = state.get(name)!;
    if (s.running) return;
    s.running = true;
    s.runs++;
    try {
      await fn();
      s.lastOk = Date.now();
      s.failuresInARow = 0;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      s.failures++;
      s.failuresInARow++;
      s.lastError = { at: Date.now(), message };
      log(`${name}: ${message}\n`);
    } finally {
      s.running = false;
      s.healthy = s.failuresInARow < UNHEALTHY_AFTER;
    }
  }

  const add = (name: string) => state.set(name, { name, runs: 0, failures: 0, failuresInARow: 0, healthy: true, running: false });

  return {
    /** Runs `fn` every `ms`, skipping a tick while the previous run is still going. */
    every(name: string, ms: number, fn: () => unknown, opts: { now?: boolean } = {}) {
      add(name);
      const t = setInterval(() => void run(name, fn), ms);
      timers.add(t);
      if (opts.now) void run(name, fn);
    },
    /** Runs `fn` now, then again `pauseMs` after each run ends. */
    loop(name: string, fn: () => unknown, pauseMs: number) {
      add(name);
      const next = async () => {
        await run(name, fn);
        if (stopped) return;
        const t = setTimeout(() => {
          timers.delete(t);
          void next();
        }, pauseMs);
        timers.add(t);
      };
      void next();
    },
    /** Runs `fn` once after `ms`. */
    after(name: string, ms: number, fn: () => unknown) {
      add(name);
      const t = setTimeout(() => {
        timers.delete(t);
        void run(name, fn);
      }, ms);
      timers.add(t);
    },
    status: (): JobStatus[] => [...state.values()].map((s) => ({ ...s })),
    stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

export type Jobs = ReturnType<typeof createJobs>;
