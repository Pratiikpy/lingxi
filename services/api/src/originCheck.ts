/**
 * R13: a write is taken only from the game's own pages. Another site's page can make a visitor's browser post here
 * without asking first (text/plain with no-cors needs no preflight), and CORS only hides the answer: the write was
 * done, from the visitor's address, against the visitor's limits. A browser always names the page such a write comes
 * from in the Origin header, so a write whose Origin is neither one of ours nor the server's own is refused before
 * its route runs. A request with no Origin is not a browser's cross-site write (a program, an agent's client, the
 * status check) and goes on to its route's own checks; the agent API (/api/v1) is open to any page by design, its
 * writes carrying a token.
 */
import type { Hono } from "hono";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Whether `origin` is the page the request itself was sent to: same host and port, over https (or http on this PC). */
function sameAsHost(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  if (origin === `https://${host}`) return true;
  return origin === `http://${host}` && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export function withOriginCheck(app: Hono, origins: readonly string[]): Hono {
  app.use("/api/*", async (c, next) => {
    if (!WRITES.has(c.req.method) || c.req.path.startsWith("/api/v1")) return next();
    const origin = c.req.header("origin");
    if (origin === undefined || origins.includes(origin) || sameAsHost(origin, c.req.header("host"))) return next();
    return c.json({ ok: false, reason: "origin" }, 403);
  });
  return app;
}
