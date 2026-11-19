/**
 * A32: short duel links. A duel link carried its whole challenge inline, card and all, often thousands of characters,
 * more than a chat message holds. The server keeps a duel code under the first 16 characters of the code's SHA-256
 * (`duelLinkId`), and the link carries only that id. The same code always has the same id, so nothing piles up, and the
 * game checks that the code it fetches hashes back to the id, so the server cannot swap one challenge for another.
 * Only real challenges and results are kept: each is read as the game reads it before it is stored.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { MAX_DUEL_RESULT_CODE, decodeChallenge, decodeResult, duelLinkId } from "@lingxi/game";
import { clientIp } from "./clientIp";
import { RateLimiter } from "./limit";

/** How many codes are kept, and how many characters in all; past either, the oldest go first. */
const MAX_KEPT = 50_000;
const MAX_KEPT_CHARS = 200_000_000;
const ID = /^[A-Za-z0-9_-]{16}$/;

/**
 * The codes, one file each in `dir` (named by id, so a code is written once and read by its name), or in memory when no
 * folder is given (tests).
 */
export function createDuelStore(dir?: string, limits: { count: number; chars: number } = { count: MAX_KEPT, chars: MAX_KEPT_CHARS }) {
  const kept = new Map<string, { at: number; size: number }>();
  const memory = new Map<string, string>();
  let chars = 0;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      const id = name.replace(/\.txt$/, "");
      if (!ID.test(id)) continue;
      const st = statSync(join(dir, name));
      kept.set(id, { at: st.mtimeMs, size: st.size });
      chars += st.size;
    }
  }
  const drop = (id: string) => {
    const k = kept.get(id);
    if (!k) return;
    kept.delete(id);
    chars -= k.size;
    if (dir) rmSync(join(dir, `${id}.txt`), { force: true });
    else memory.delete(id);
  };
  return {
    get: (id: string): string | null => {
      if (!kept.has(id)) return null;
      if (!dir) return memory.get(id) ?? null;
      try {
        return readFileSync(join(dir, `${id}.txt`), "utf8");
      } catch {
        return null;
      }
    },
    put: (id: string, code: string, at: number) => {
      if (kept.has(id)) return;
      if (dir) {
        writeFileSync(join(dir, `${id}.tmp`), code);
        renameSync(join(dir, `${id}.tmp`), join(dir, `${id}.txt`));
      } else memory.set(id, code);
      kept.set(id, { at, size: code.length });
      chars += code.length;
      if (kept.size > limits.count || chars > limits.chars) {
        for (const [old] of [...kept].sort((a, b) => a[1].at - b[1].at)) {
          if (kept.size <= limits.count && chars <= limits.chars) break;
          if (old !== id) drop(old);
        }
      }
    },
    size: () => kept.size,
  };
}
export type DuelStore = ReturnType<typeof createDuelStore>;

/** Whether a code is a challenge or a result the game would read. */
function readable(code: string): boolean {
  if (code.length > MAX_DUEL_RESULT_CODE) return false;
  try {
    if (code.startsWith("lxc1.")) decodeChallenge(code);
    else if (code.startsWith("lxr1.")) decodeResult(code);
    else return false;
    return true;
  } catch {
    return false;
  }
}

/** POST /api/duels { code } → { ok, id }; GET /api/duels/:id → { ok, code }, or { ok: false } for a code not kept. */
export function withDuels(app: Hono, store: DuelStore, limiter = new RateLimiter(30, 60_000), now: () => number = Date.now): Hono {
  app.post("/api/duels", async (c) => {
    if (!limiter.take(clientIp(c))) return c.json({ ok: false, reason: "busy" }, 429);
    let code: unknown;
    try {
      code = ((await c.req.json()) as { code?: unknown }).code;
    } catch {
      return c.json({ ok: false, reason: "code" }, 400);
    }
    if (typeof code !== "string" || !readable(code)) return c.json({ ok: false, reason: "code" }, 400);
    const id = await duelLinkId(code);
    store.put(id, code, now());
    return c.json({ ok: true, id });
  });
  app.get("/api/duels/:id", (c) => {
    const id = c.req.param("id");
    c.header("access-control-allow-origin", "*");
    if (!ID.test(id)) return c.json({ ok: false, reason: "id" }, 400);
    const code = store.get(id);
    // a code not kept (never made here, or let go past the limits) is an answer, not an error: the game says so plainly,
    // and a browser logs every 4xx as an error
    if (!code) {
      c.header("cache-control", "no-store");
      return c.json({ ok: false, reason: "unknown" });
    }
    // a code never changes under its id
    c.header("cache-control", "public, max-age=31536000, immutable");
    return c.json({ ok: true, code });
  });
  return app;
}
