/**
 * The largest body each write route accepts, enforced on the bytes actually read: a `content-length` check alone is
 * skipped by a chunked request that sends none. Each size is the route's own largest honest request with room to
 * spare; anything else gets 64 KB.
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

const KB = 1024;
/** [path pattern, bytes] — the first that matches wins */
export const BODY_LIMITS: ReadonlyArray<readonly [RegExp, number]> = [
  // a whole game save moving to another device (every local store, as text)
  [/^\/api\/move$/, 4096 * KB],
  // a pet's published thought log: up to 100,000 words, listed twice (whole and by brain)
  [/^\/api\/pets\/\d+\/log$/, 1536 * KB],
  // adoption papers (PAPERS_MAX 600,000 characters) and their signature
  [/^\/api\/papers\/\d+$/, 620 * KB],
  // a pet left with a friend, or coming home from one (700,000 as before)
  [/^\/api\/sit(\/[^/]+\/home)?$/, 700 * KB],
  [/^\/api\/(arena\/snapshot|season\/enter)$/, 16 * KB],
  [/^\/api\/(teach|voice|lessons\/share|push\/(plan|stop))$/, 16 * KB],
  [/^\/api\/v1\//, 16 * KB],
  [/^\/api\/tapeout/, 24 * KB],
];
export const DEFAULT_BODY_LIMIT = 64 * KB;

export const limitFor = (path: string): number => BODY_LIMITS.find(([re]) => re.test(path))?.[1] ?? DEFAULT_BODY_LIMIT;

/** Applies each route's limit to every write under /api. */
export function withBodyLimits(app: Hono): Hono {
  const cache = new Map<number, MiddlewareHandler>();
  const of = (max: number) => {
    let mw = cache.get(max);
    if (!mw) {
      mw = bodyLimit({ maxSize: max, onError: (c: Context) => c.json({ ok: false, reason: "tooBig" }, 413) });
      cache.set(max, mw);
    }
    return mw;
  };
  app.use("/api/*", async (c, next) => (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS" ? next() : of(limitFor(c.req.path))(c, next)));
  return app;
}
