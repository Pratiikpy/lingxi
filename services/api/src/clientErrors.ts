/**
 * P8: the game's own uncaught errors, reported by players' browsers so their bugs are seen without anyone writing in.
 * A report is a message, a place and a build. What could name a player (an address, a key or hash, an email, a long
 * number) is scrubbed from the message before it is kept; the client's address is used only to limit it and is never
 * stored. The same error again is counted, not stored twice; a bounded number of distinct errors is kept, the oldest
 * going first. Each one also goes to the server's log (rotated by the watchdog), so the record outlives a restart.
 */
import { type Context, Hono } from "hono";
import { ClientErrorBody } from "@lingxi/api-schema";
import { RateLimiter } from "./limit";
import { clientIp } from "./clientIp";
import { busy } from "./routes/play";

/** Removes from a message what could name a player: addresses, keys and hashes, emails, long numbers. */
export function scrub(text: string): string {
  return text
    .replace(/0x[0-9a-fA-F]{8,}/g, "0x…")
    .replace(/\b[0-9a-fA-F]{32,}\b/g, "…")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "…")
    .replace(/\d{10,}/g, "#…");
}

export interface ClientError {
  message: string;
  where: string;
  build: string;
  count: number;
  first: number;
  last: number;
}

const HOUR = 3_600_000;
/** At most this many reports are counted for the last hour (each client may send 20 an hour). */
const MAX_TIMES = 10_000;

export function createErrorLog(o: { keep?: number; now?: () => number; log?: (line: string) => void } = {}) {
  const keep = o.keep ?? 50;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  // insertion order is age: a repeat moves its error to the newest end
  const errors = new Map<string, ClientError>();
  const times: number[] = [];
  return {
    add(r: { message: string; where: string; build: string }): void {
      const at = now();
      const message = scrub(r.message);
      const where = scrub(r.where);
      const key = `${message}\n${where}\n${r.build}`;
      const held = errors.get(key);
      errors.delete(key);
      errors.set(
        key,
        held
          ? { ...held, count: held.count + 1, last: at }
          : { message, where, build: r.build, count: 1, first: at, last: at },
      );
      while (errors.size > keep) errors.delete(errors.keys().next().value as string);
      times.push(at);
      // the hour's count is bounded too: past this many, the oldest go first
      while (times.length > MAX_TIMES || (times.length && (times[0] ?? at) < at - HOUR)) times.shift();
      log(`client error (${r.build}) at ${where}: ${message}\n`);
    },
    /** The most recently seen distinct errors, newest first. */
    latest(n: number): ClientError[] {
      return [...errors.values()].reverse().slice(0, n);
    },
    /** How many reports came in the last hour, repeats included. */
    lastHour(): number {
      const at = now();
      return times.filter((t) => t >= at - HOUR).length;
    },
  };
}

export type ErrorLog = ReturnType<typeof createErrorLog>;

/** POST /api/errors: one report, limited per client, every field capped (ClientErrorBody). */
export function withErrors(app: Hono, log: ErrorLog, limiter = new RateLimiter(20, HOUR)): Hono {
  app.post("/api/errors", async (c: Context) => {
    if (!limiter.take(clientIp(c))) return busy(c);
    let body: ClientErrorBody;
    try {
      body = ClientErrorBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    log.add(body);
    return c.json({ ok: true });
  });
  return app;
}
