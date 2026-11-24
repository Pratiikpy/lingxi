/**
 * A34: the daily challenge's block. Every player's challenge for a UTC day is seeded by the first X Layer block at or
 * after that day's midnight. The browser used to search for it itself, straight from the public nodes, and a node's
 * rate-limit reply (which drops its CORS headers) showed as blocked requests in the player's console; every player
 * repeated the same search. The server now finds each day's block once from X Layer mainnet, keeps it (a block never
 * changes) and serves it same-origin; the game checks the answer through the same-origin door (`/api/rpc`).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Hono } from "hono";
import { DAY_MS, dayIndex, firstBlockAtOrAfter } from "@lingxi/game";
import { hasStore, readStore, saveJson } from "./durable";

/** How far back a day may be asked for: a player's clock, or a page left open, may be a little behind. */
const OLDEST_DAYS = 30;
/** After the nodes fail, how long before the next ask searches again. */
const RETRY_AFTER_MS = 30_000;
const DAY = /^\d{1,6}$/;

export interface ChainHead {
  number: number;
  timestamp: number;
}
export interface ChainReader {
  head: () => Promise<ChainHead>;
  block: (n: number) => Promise<{ number: number; timestamp: number; hash: `0x${string}` }>;
}
export type DailyAnswer =
  | { ok: true; day: number; block: number; hash: `0x${string}` }
  | { ok: false; reason: "notYet" | "tooOld" | "unavailable" };
type Found = Extract<DailyAnswer, { ok: true }>;

/** Thrown by the search when the chain has not reached the day's midnight. */
class NotYet extends Error {}

export function createDailyBlocks(reader: ChainReader, opts: { now?: () => number; file?: string } = {}) {
  const now = opts.now ?? Date.now;
  const kept = new Map<number, Found>();
  if (opts.file && hasStore(opts.file)) {
    try {
      for (const f of readStore(opts.file) as Found[])
        if (f?.ok && Number.isInteger(f.day) && Number.isInteger(f.block) && /^0x[0-9a-f]{64}$/.test(f.hash))
          kept.set(f.day, f);
    } catch {
      // a damaged file is searched again, day by day, as asked
    }
  }
  const save = () => {
    if (!opts.file) return;
    mkdirSync(dirname(opts.file), { recursive: true });
    saveJson(opts.file, undefined, JSON.stringify([...kept.values()]));
  };
  const searching = new Map<number, Promise<DailyAnswer>>();
  let failedAt = -Infinity;

  const search = async (day: number): Promise<Found> => {
    const midnight = (day * DAY_MS) / 1000;
    const head = await reader.head();
    if (head.timestamp < midnight) throw new NotYet();
    const n = await firstBlockAtOrAfter(midnight, head, async (b) => (await reader.block(b)).timestamp);
    const b = await reader.block(n);
    return { ok: true, day, block: n, hash: b.hash };
  };

  return {
    get: (day: number): Promise<DailyAnswer> => {
      const today = dayIndex(now());
      if (day > today) return Promise.resolve({ ok: false, reason: "notYet" });
      if (day < today - OLDEST_DAYS) return Promise.resolve({ ok: false, reason: "tooOld" });
      const have = kept.get(day);
      if (have) return Promise.resolve(have);
      const running = searching.get(day);
      if (running) return running;
      if (now() - failedAt < RETRY_AFTER_MS) return Promise.resolve({ ok: false, reason: "unavailable" });
      const run = search(day)
        .then((found): DailyAnswer => {
          kept.set(day, found);
          save();
          return found;
        })
        .catch((e): DailyAnswer => {
          if (e instanceof NotYet) return { ok: false, reason: "notYet" };
          failedAt = now();
          return { ok: false, reason: "unavailable" };
        })
        .finally(() => searching.delete(day));
      searching.set(day, run);
      return run;
    },
  };
}
export type DailyBlocks = ReturnType<typeof createDailyBlocks>;

/**
 * GET /api/daily/:day → the day's block, or why there is none yet. Every answer a player can meet is a 200 (a browser
 * logs every 4xx and 5xx as an error); only a malformed day is a 400.
 */
export function withDaily(app: Hono, daily: DailyBlocks): Hono {
  app.get("/api/daily/:day", async (c) => {
    const raw = c.req.param("day");
    if (!DAY.test(raw)) return c.json({ ok: false, reason: "day" }, 400);
    const answer = await daily.get(Number(raw));
    // a day's block never changes; anything else may change within the minute
    c.header("cache-control", answer.ok ? "public, max-age=31536000, immutable" : "no-store");
    return c.json(answer);
  });
  return app;
}
