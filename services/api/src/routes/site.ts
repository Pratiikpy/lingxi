/**
 * Serving the site (P7: out of server.ts): the live release, its caching, byte ranges, and the script policy
 * each page is sent with.
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type SiteSource, folderSource } from "../releases";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

/**
 * Serves the built site from the same origin as the API, with safe headers: the
 * landing page at /, the game at /play.html, the proof page at /verify.html.
 */
/** A Range in the only unit and syntax a file can answer: bytes, one or more N-M, N- or -N. */
export const BYTE_RANGES = /^bytes=(\d+-\d*|-\d+)(\s*,\s*(\d+-\d*|-\d+))*$/;

/** How many folders' file servers, and pages' policies, the site keeps at once: releases come and go, memory stays bounded. */
export const SITE_CACHE_MAX = 64;

/** Where pages may load scripts from besides our own origin: Telegram's Mini App script and Cloudflare's analytics beacon. */
export const SCRIPT_HOSTS = ["https://telegram.org", "https://static.cloudflareinsights.com"];

/** The inline scripts of a page, as the CSP hashes that allow exactly them and nothing else. */
export function scriptPolicy(html: string): { hashes: string[] } {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1] ?? "")) continue;
    // the browser hashes the script as HTML parsing leaves it: every CRLF or lone CR read as LF
    const text = (m[2] ?? "").replace(/\r\n?/g, "\n");
    hashes.push(`'sha256-${createHash("sha256").update(text).digest("base64")}'`);
  }
  return { hashes };
}

/**
 * The built site: a folder (tests, a rehearsal) or the live release of a releases folder (A10). Pages come only from
 * the live folder; an asset it does not have may be one an earlier release still serves, for a page that was open
 * when the next went live (A4).
 */
export function withSite(app: Hono, site: string | SiteSource): Hono {
  const source = typeof site === "string" ? folderSource(site) : site;
  // each page's policy, from its own file: re-read when the release or the build changes it
  const policies = new Map<string, { mtimeMs: number; csp: string }>();
  const policyFor = (root: string | null, path: string): string | null => {
    if (!root) return null;
    const file = join(root, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
    if (!/\.html$/.test(file)) return null;
    try {
      const { mtimeMs } = statSync(file);
      const held = policies.get(file);
      if (held && held.mtimeMs === mtimeMs) return held.csp;
      const { hashes } = scriptPolicy(readFileSync(file, "utf8"));
      // the game runs inside Telegram Web's frame as a Mini App; every other page stays unframeable by others. Workers may
      // also come from blob: URLs, which only a script already running on the page can make (Pixi decodes images in one)
      const frames = path === "/play.html" ? "'self' https://web.telegram.org https://*.web.telegram.org" : "'self'";
      const csp = [
        `script-src 'self' 'wasm-unsafe-eval' ${[...SCRIPT_HOSTS, ...hashes].join(" ")}`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        `frame-ancestors ${frames}`,
      ].join("; ");
      // releases come and go: the memory of their pages' policies is bounded, and simply rebuilt when cleared
      if (policies.size >= SITE_CACHE_MAX) policies.clear();
      policies.set(file, { mtimeMs, csp });
      return csp;
    } catch {
      return null;
    }
  };
  // the release a request is answered from is fixed when it arrives, so its page and its policy always match
  const rootOf = new WeakMap<Request, string | null>();
  app.use("*", async (c, next) => {
    rootOf.set(c.req.raw, source.root());
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    const csp = policyFor(rootOf.get(c.req.raw) ?? null, c.req.path);
    if (csp) c.header("Content-Security-Policy", csp);
    // a page is always asked for again (a cheap 304 while unchanged), so no browser keeps one past a deploy (A4)
    if (c.req.path === "/" || c.req.path.endsWith(".html")) c.header("Cache-Control", "no-cache");
    if (c.req.path !== "/play.html") c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  });
  app.use("/assets/*", async (c, next) => {
    await next();
    // hashed file names: a file that exists is safe to cache for a year; a missing one must never be
    c.header(
      "Cache-Control",
      c.res.status === 200 || c.res.status === 206 ? "public, max-age=31536000, immutable" : "no-store",
    );
  });
  // one file server per folder, made the first time the folder is served from
  const servers = new Map<string, ReturnType<typeof serveStatic>>();
  const serverFor = (dir: string) => {
    let s = servers.get(dir);
    if (!s) {
      s = serveStatic({
        root: relative(process.cwd(), dir) || ".",
        rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
      });
      if (servers.size >= SITE_CACHE_MAX) servers.clear();
      servers.set(dir, s);
    }
    return s;
  };
  // A Range the static server cannot read (words, an unknown unit) made it throw, a 500. HTTP says to ignore such a
  // Range and send the whole file; a range that starts past the end is refused with 416.
  app.use("/*", async (c, next) => {
    const range = c.req.header("range");
    if (range !== undefined && !BYTE_RANGES.test(range.trim())) {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("range");
      return app.fetch(new Request(c.req.raw, { headers }));
    }
    const root = rootOf.get(c.req.raw) ?? null;
    if (!root) {
      c.header("Retry-After", "30");
      return c.text("Lingxi is being released; try again in a moment.", 503);
    }
    try {
      if (!c.req.path.startsWith("/assets/")) return await serverFor(root)(c, next);
      // the live release first; then each earlier release still kept, newest first
      const earlier = source.fallbacks();
      const from = (i: number) => async () => {
        if (i >= earlier.length) return next();
        // a file found answers with its Response; otherwise the request goes on to the next folder, then to a 404
        const res: unknown = await serverFor(earlier[i]!)(c, from(i + 1));
        if (res instanceof Response) c.res = res;
      };
      return await serverFor(root)(c, from(0));
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_OUT_OF_RANGE") return c.body(null, 416);
      throw e;
    }
  });
  // P6: a page the site does not have is answered with the release's own not-found page, status 404; the API and a
  // release without the page keep the plain answer
  app.notFound((c) => {
    const root = rootOf.get(c.req.raw) ?? null;
    const page = root && c.req.method === "GET" && !c.req.path.startsWith("/api/") ? join(root, "404.html") : null;
    if (page && existsSync(page)) return c.html(readFileSync(page, "utf8"), 404);
    return c.text("404 Not Found", 404);
  });
  return app;
}
