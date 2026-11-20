/**
 * Heavy reads, limited per caller (A78). Each of these answers can run to hundreds of kilobytes or more (a week's
 * season with every card, a pet's whole diary, a duel result with two cards, the tree of every pet), so repeated
 * without limit they would take the request thread and the line. Each limit is well above what a real player's pages
 * ask in a minute; past it the answer is "busy" (200, so a browser logs nothing), and other callers are not affected.
 */

import type { Hono } from "hono";
import { clientIp } from "./clientIp";
import { RateLimiter } from "./limit";

/** [path pattern, reads a minute per caller] — the first that matches wins */
export const READ_LIMITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^\/api\/season\/[^/]+$/, 60],
  [/^\/api\/pets\/\d+\/log$/, 30],
  [/^\/api\/duels\/[^/]+$/, 120],
  [/^\/api\/tree$/, 30],
  [/^\/api\/v1\/agents\/me$/, 60],
];

/** Applies each heavy read's limit; registered before the routes, as the body limits are. */
export function withReadLimits(app: Hono): Hono {
  const limiters = READ_LIMITS.map(([re, n]) => [re, new RateLimiter(n, 60_000)] as const);
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET") return next();
    const hit = limiters.find(([re]) => re.test(c.req.path));
    if (hit && !hit[1].take(clientIp(c))) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, reason: "busy" });
    }
    return next();
  });
  return app;
}
