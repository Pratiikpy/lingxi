/**
 * Little Mars's count on Builders' Lane (PRD R2): how many circuits were taped
 * out on X Layer today. Every few minutes the server reads every processor in
 * TapeOut's factory and sums how many circuits each has made (nextId − 1). The
 * first reading of each UTC day is that day's baseline, so today's count is the
 * latest total minus the baseline. A day with no baseline (the server started
 * mid-day) counts from its first reading and says so.
 */

import type { Hono } from "hono";
import { hasStore, readStore, saveJson } from "./durable";

export interface TapeoutReading {
  at: number;
  total: number;
  processors: number;
}

/** Reads the whole factory: how many processors, and how many circuits they have made in all. */
export type TapeoutReader = () => Promise<{ total: number; processors: number }>;

interface Saved {
  day: string;
  baseline: TapeoutReading;
  latest: TapeoutReading;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createTapeoutCounter(read: TapeoutReader, file?: string, now: () => number = Date.now) {
  let saved: Saved | null = null;
  if (file && hasStore(file)) {
    try {
      saved = readStore(file) as Saved;
    } catch {
      saved = null;
    }
  }
  const persist = () => {
    if (!file || !saved) return;
    saveJson(file, undefined, JSON.stringify(saved));
  };
  return {
    /** Takes one reading; a new UTC day starts a new baseline. */
    async tick(): Promise<void> {
      const r = await read();
      const reading = { at: now(), ...r };
      const day = dayOf(reading.at);
      if (!saved || saved.day !== day) {
        // the previous day's last reading is the best baseline for the new day, when it is recent
        const carry = saved && reading.at - saved.latest.at < 30 * 60_000 ? saved.latest : reading;
        saved = { day, baseline: carry, latest: reading };
      } else saved = { ...saved, latest: reading };
      persist();
    },
    view(): { ok: true; today: number; total: number; processors: number; since: string } | { ok: false } {
      if (!saved || saved.day !== dayOf(now())) return { ok: false };
      return { ok: true, today: Math.max(0, saved.latest.total - saved.baseline.total), total: saved.latest.total, processors: saved.latest.processors, since: new Date(saved.baseline.at).toISOString().slice(11, 16) };
    },
  };
}
export type TapeoutCounter = ReturnType<typeof createTapeoutCounter>;

export function withLane(app: Hono, counter: TapeoutCounter): Hono {
  app.get("/api/lane/tapeouts", (c) => {
    c.header("Cache-Control", "public, max-age=60");
    return c.json(counter.view());
  });
  return app;
}
