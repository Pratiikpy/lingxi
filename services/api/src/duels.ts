/**
 * A32: short duel links. A duel link carried its whole challenge inline, card and all, often thousands of characters,
 * more than a chat message holds. The server keeps a duel code under the first 16 characters of the code's SHA-256
 * (`duelLinkId`), and the link carries only that id. The same code always has the same id, so nothing piles up, and the
 * game checks that the code it fetches hashes back to the id, so the server cannot swap one challenge for another.
 * Only real challenges and results are kept: each is read as the game reads it before it is stored.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Hono } from "hono";
import { MAX_DUEL_RESULT_CODE, decodeChallenge, decodeResult, duelLinkId } from "@lingxi/game";
import { clientIp } from "./clientIp";
import { PREFIX_SHARE, RateLimiter, prefixOf } from "./limit";
import { writeFlushed } from "./durable";
import { pseudonym } from "./pseudonym";
import { own } from "./own";

/** How many codes are kept, and how many characters in all; past either, those nobody has opened for longest go first. */
const MAX_KEPT = 50_000;
const MAX_KEPT_CHARS = 200_000_000;
/** The characters of new links one address may store in a day: about twenty of the largest results (A51). */
export const PER_ADDRESS_DAY_CHARS = 4_000_000;
/**
 * The callers (addresses, and IPv6 /48s) the day's map keeps its own count for (P10); past them, a newcomer's characters
 * count in one count shared by every newcomer, "(others)", held to one address's day. A crowd of addresses cannot grow
 * the map, and none gets an allowance of its own by coming once it is full.
 */
export const MAX_SPENDERS = 20_000;
const OTHERS = "(others)";
/** A link's file time is moved to its last opening at most this often, so the order survives a restart. */
const TOUCH_MS = 60_000;
const ID = /^[A-Za-z0-9_-]{16}$/;
/**
 * The part of the shelf one maker may hold, in links and in characters (A83): past it the maker's own least opened
 * link goes, so opening one's own links cannot hold the shelf against everyone else's; an IPv6 /48 holds four makers'
 * worth (limit.ts). Who made a link is in its file's name (keyed codes of the address and its /48, pseudonym.ts), so a
 * restart keeps it with no index to rewrite.
 */
export const MAKER_SHARE = 1 / 200;
/**
 * `<id>.txt` (made before A83: no maker), or `<id>.<maker>.<network or ->.txt`: the maker and network as 16-character
 * keyed codes, or (made before P6a) as 12-character plain hashes, which are renamed to codes on open
 */
const FILE = /^([A-Za-z0-9_-]{16})(?:\.([0-9a-f]{12}|[0-9a-f]{16})\.([0-9a-f]{12}|[0-9a-f]{16}|-))?\.txt$/;
/** the plain hash a maker had before P6a: anyone could work it out for a guessed address */
const plainTag = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** a plain hash as the keyed code the same maker has now, so links made before keep counting against their maker */
const keyedTag = (plain: string) => pseudonym("duel", plain);
const tag = (s: string) => keyedTag(plainTag(s));
const PLAIN = /^[0-9a-f]{12}$/;

/**
 * The codes, one file each in `dir` (named by id, so a code is written once and read by its name), or in memory when no
 * folder is given (tests).
 */
export function createDuelStore(
  dir?: string,
  limits: { count: number; chars: number } = { count: MAX_KEPT, chars: MAX_KEPT_CHARS },
  now: () => number = Date.now,
) {
  /** `at`: when it was made or last opened, whichever is later (its file's time, on disk); `by` and `net`: its maker */
  const kept = new Map<string, { at: number; size: number; by?: string; net?: string }>();
  const memory = new Map<string, string>();
  let chars = 0;
  const fileOf = (id: string) => {
    const k = kept.get(id);
    return join(dir!, k?.by ? `${id}.${k.by}.${k.net ?? "-"}.txt` : `${id}.txt`);
  };
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      // a write a crash cut short left a temporary file: it is cleared, never read (A123)
      if (name.endsWith(".tmp")) {
        rmSync(join(dir, name), { force: true });
        continue;
      }
      const m = FILE.exec(name);
      if (!m) continue;
      const st = statSync(join(dir, name));
      const by = m[2] && PLAIN.test(m[2]) ? keyedTag(m[2]) : m[2] && own(m[2]);
      const net = m[3] && m[3] !== "-" ? (PLAIN.test(m[3]) ? keyedTag(m[3]) : own(m[3])) : undefined;
      // the id, cut from the file's name, as a string of its own (P10)
      kept.set(own(m[1]!), { at: st.mtimeMs, size: st.size, ...(by ? { by } : {}), ...(net ? { net } : {}) });
      // a name from before P6a takes its keyed codes; a rename keeps the file's time, so the order survives
      if (join(dir, name) !== fileOf(m[1]!)) renameSync(join(dir, name), fileOf(m[1]!));
      chars += st.size;
    }
  }
  const drop = (id: string) => {
    const k = kept.get(id);
    if (!k) return;
    if (dir) rmSync(fileOf(id), { force: true });
    else memory.delete(id);
    kept.delete(id);
    chars -= k.size;
  };
  /** the maker's own (or its network's) least opened links go, never `keep`, until it is within `count` and `most` */
  const share = (keep: string, mine: (k: { by?: string; net?: string }) => boolean, count: number, most: number) => {
    const own = [...kept].filter(([, k]) => mine(k)).sort((a, b) => a[1].at - b[1].at);
    let n = own.length;
    let size = own.reduce((t, [, k]) => t + k.size, 0);
    for (const [old, k] of own) {
      if (n <= count && size <= most) break;
      if (old === keep) continue;
      drop(old);
      n--;
      size -= k.size;
    }
  };
  return {
    get: (id: string): string | null => {
      const k = kept.get(id);
      if (!k) return null;
      // opened now: a link people still open is kept ahead of ones nobody opens (A51)
      const t = now();
      const touch = t - k.at > TOUCH_MS;
      if (touch) kept.set(id, { ...k, at: t });
      if (!dir) return memory.get(id) ?? null;
      try {
        const code = readFileSync(fileOf(id), "utf8");
        if (touch) utimesSync(fileOf(id), t / 1000, t / 1000);
        return code;
      } catch {
        return null;
      }
    },
    has: (id: string) => kept.has(id),
    /** keeps `code` under `id`, made by `maker` (a caller, as clientIp names it) */
    put: (cut: string, code: string, at: number, maker?: string) => {
      if (kept.has(cut)) return;
      // the id, cut from its code's whole digest (duelLinkId), as a string of its own (P10)
      const id = own(cut);
      const prefix = maker === undefined ? null : prefixOf(maker);
      const who: { by?: string; net?: string } =
        maker === undefined ? {} : { by: tag(maker), ...(prefix !== null ? { net: tag(prefix) } : {}) };
      kept.set(id, { at, size: code.length, ...who });
      if (dir) {
        writeFlushed(join(dir, `${id}.tmp`), code);
        // the file keeps the store's own time, as an opening does, so a restart restores the same order (A96)
        utimesSync(join(dir, `${id}.tmp`), at / 1000, at / 1000);
        renameSync(join(dir, `${id}.tmp`), fileOf(id));
      } else memory.set(id, code);
      chars += code.length;
      // the maker's share first, then its network's (A83)
      const count = Math.max(1, Math.floor(limits.count * MAKER_SHARE));
      const most = Math.max(1, Math.floor(limits.chars * MAKER_SHARE));
      if (who.by) share(id, (k) => k.by === who.by, count, most);
      if (who.net) share(id, (k) => k.net === who.net, count * PREFIX_SHARE, most * PREFIX_SHARE);
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
export function withDuels(
  app: Hono,
  store: DuelStore,
  limiter = new RateLimiter(30, 60_000),
  now: () => number = Date.now,
  perAddressDay = PER_ADDRESS_DAY_CHARS,
  maxSpenders = MAX_SPENDERS,
): Hono {
  /** the characters each address has stored today (A51) */
  let day = "";
  const spent = new Map<string, number>();
  // a refusal is an answer, not an error: the game keeps its long link, and a browser logs every 4xx as an error
  app.post("/api/duels", async (c) => {
    const ip = clientIp(c);
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy" });
    let code: unknown;
    try {
      code = ((await c.req.json()) as { code?: unknown }).code;
    } catch {
      return c.json({ ok: false, reason: "code" }, 400);
    }
    if (typeof code !== "string" || !readable(code)) return c.json({ ok: false, reason: "code" }, 400);
    const id = await duelLinkId(code);
    // a code already kept costs nothing again; a new one counts against its address's day
    if (!store.has(id)) {
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        spent.clear();
      }
      // an address stores its day's characters, and its IPv6 /48 four addresses' worth (A123); past MAX_SPENDERS
      // callers, a newcomer counts in the one shared count, held to one address's day (P10)
      const keyOf = (k: string) => (spent.has(k) || spent.size < maxSpenders ? k : OTHERS);
      const me = keyOf(ip);
      const prefix = prefixOf(ip);
      const net = prefix === null ? null : keyOf(prefix);
      const used = spent.get(me) ?? 0;
      const network = net === null || net === me ? 0 : (spent.get(net) ?? 0);
      const netDay = net === OTHERS ? perAddressDay : perAddressDay * PREFIX_SHARE;
      if (used + code.length > perAddressDay || (net !== null && net !== me && network + code.length > netDay))
        return c.json({ ok: false, reason: "busy" });
      spent.set(me, used + code.length);
      if (net !== null && net !== me) spent.set(net, network + code.length);
    }
    store.put(id, code, now(), ip);
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
