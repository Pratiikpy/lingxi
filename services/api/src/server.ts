/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { type SiteSource, folderSource, releaseSource } from "./releases";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { circuitBrain } from "@lingxi/brain";
import {
  ArenaOpponentQuery,
  ArenaSnapshotBody,
  BrainRelayPayload,
  ChildRelayPayload,
  InstinctRelayPayload,
  LessonKeyBody,
  LessonShareBody,
  MoveBody,
  PublishedLog,
  PushPlanBody,
  PushStopBody,
  RelayEnvelope,
  SeasonEnterBody,
  SitHomeBody,
  SitLeaveBody,
  TeachBody,
  VoiceBody,
} from "@lingxi/api-schema";
import { mindOf, teachInWords } from "./teach";
import { RateLimiter } from "./limit";
import { BrainRelayer, type RelayResult } from "./relayer";
import { RelayQuota, checkRelayAuth, createNonceBook } from "./relayGate";
import { LiveRooms, attachLive } from "./live";
import { createDecorStore } from "./decor";
import { type SittingStore, createSittingStore } from "./sitting";
import { type ArenaStore, createArenaStore } from "./arena";
import { type SeasonStore, createSeasonStore, settleAwards } from "./season";
import { weekOf } from "@lingxi/game";
import { parseCard } from "@lingxi/game";
import { createPublicClient, http, type PublicClient } from "viem";
import { type Deployment, type SignedRelay, adoptionCentreAbi, loadCircuitFromChain, nameColours, packsHeld, petRegistryAbi, piecesHeld, readPet, xLayer } from "@lingxi/chain";
import { type HomeChain, createHomes } from "./homes";
import { createAgentStore } from "./agents";
import { withAgentApi } from "./agentApi";
import { type Letter, currentLetters, loadLetters } from "./mail";
import { createPusher, type Pusher } from "./push";
import { createVoice } from "./voice";
import { createLibrary, type Library } from "./library";
import { createIndexer, type Indexer } from "./indexer";
import { createPacketIndex, type PacketIndex } from "./packets";
import { createGoalLedger, withGoals } from "./goals";
import { withVouchers } from "./voucher";
import { createPapersStore, withPapers } from "./papers";
import { withRpcProxy } from "./rpc";
import { privateKeyToAccount } from "viem/accounts";
import { createSalesCounter, withNumbers } from "./numbers";
import { buildTree } from "./tree";
import { type DiaryStore, createDiaryStore } from "./diaries";
import { MAX_MOVE_CHARS, type MoveStore, createMoveStore } from "./move";
import { createTapeoutCounter, withLane } from "./lane";
import { factoryReader } from "./laneReader";
import { petLookAbi as lookAbi } from "@lingxi/chain";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import { clientIp } from "./clientIp";
import { withBodyLimits } from "./bodyLimits";
import { proveSeasonEntry } from "./seasonProof";
import { budgetedClient, createTokenBudget } from "./tokenBudget";
import { createJobs } from "./jobs";

function loadKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = process.env.LINGXI_SECRETS ?? resolve(here, "../../../../.secrets/anthropic.env");
  try {
    const line = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    return line?.slice("ANTHROPIC_API_KEY=".length).trim();
  } catch {
    return undefined;
  }
}

/** What the running server adds to /api/health: its jobs, indexer lag, relayer balance and store sizes. */
export type HealthDetail = () => Promise<Record<string, unknown>> | Record<string, unknown>;

/** Who may keep a pet on chain right now (PetRegistry.isKeeper): the relayer only tapes out for them. */
export type KeeperCheck = (petId: string, who: `0x${string}`) => Promise<boolean>;

export function createApp(
  client: Anthropic | null,
  limiter = new RateLimiter(6, 60_000),
  relayer: BrainRelayer | null = null,
  // per address only against floods: each request is also signed and capped per pet and per keeper (relayGate.ts)
  relayLimiter = new RateLimiter(20, 3_600_000),
  live: LiveRooms | null = null,
  detail?: HealthDetail,
  isKeeper?: KeeperCheck,
  quota = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 12, perHour: 12 }),
) {
  const app = new Hono();
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // the agent API, and a pet's public log and history, are open to any origin; the rest answers only the game's pages
  // every write is held to its route's size before a byte of it is parsed (bodyLimits.ts)
  withBodyLimits(app);
  app.use("/api/*", cors({ origin: (o, c) => (c.req.path.startsWith("/api/v1") || (c.req.method === "GET" && /^\/api\/pets\/\d+\/(log|history)$/.test(c.req.path)) ? "*" : origins.includes(o) ? o : null), allowMethods: ["GET", "POST"], allowHeaders: ["Authorization", "Content-Type"], maxAge: 600 }));

  // the parts are booleans (true when on); `detail` is everything else worth watching, for the status check and for Prateek
  app.get("/api/health", async (c) => c.json({ ok: true, teach: client !== null, voice: client !== null, relay: relayer !== null, live: live !== null, ...(detail ? { detail: await detail() } : {}) }));
  app.get("/api/live/stats", (c) => c.json(live ? live.stats() : { online: 0, spaces: 0 }));
  // the game's clock is corrected against this one, so a device clock set wrong cannot move a pet's day (P1); the
  // on-chain copy reads X Layer's block time instead, so this answers the game's own pages only
  app.get("/api/time", (c) => c.json({ now: Date.now() }, 200, { "cache-control": "no-store" }));

  app.post("/api/teach", async (c) => {
    if (!client) return c.json({ ok: false, reason: "error", detail: "teaching is not configured" }, 503);
    const ip = clientIp(c);
    if (!limiter.take(ip)) return busy(c);
    let body: z.infer<typeof TeachBody>;
    try {
      body = TeachBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const mind = mindOf(body);
    if (!mind) return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    const result = await teachInWords(client, { words: body.words, ...(body.name !== undefined ? { name: body.name } : {}), stage: body.stage, mind });
    return result.ok || result.reason !== "busy" ? c.json(result) : busy(c);
  });

  // every relay request is the signed form (see relayGate.ts and @lingxi/chain's relayAuth.ts); its payload is the
  // route's own schema
  const nonces = createNonceBook();
  const refusalStatus: Record<string, 401 | 403 | 429> = { unsigned: 401, expired: 401, badSignature: 401, replayed: 401, notKeeper: 403, busy: 429 };

  /** The shared path of the three relay routes: who asked, how often, and what they asked for. */
  const relayRoute = <T,>(path: string, kind: "brain" | "child" | "instinct", schema: z.ZodType<T>, act: (body: T) => Promise<RelayResult>) =>
    app.post(path, async (c) => {
      if (!relayer || !isKeeper) return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
      if (!relayLimiter.take(clientIp(c))) return busy(c);
      let req: z.infer<typeof RelayEnvelope>;
      let body: T;
      try {
        req = RelayEnvelope.parse(await c.req.json());
        if (req.kind !== kind) throw new Error("kind");
        body = schema.parse(JSON.parse(req.payload));
      } catch {
        return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
      }
      const gate = await checkRelayAuth(req, { isKeeper, now: () => Date.now(), nonces });
      if (!gate.ok) return c.json({ ok: false, reason: gate.reason }, refusalStatus[gate.reason] ?? 401);
      if (!quota.allow(req.petId, gate.signer)) return busy(c);
      const result = await act(body);
      // a brain already taped out costs nothing; anything that sent a transaction is charged
      if ((result.ok && !result.reused) || (!result.ok && result.spent)) quota.spend(req.petId, gate.signer);
      const { spent: _spent, ...shown } = result as RelayResult & { spent?: boolean };
      return c.json(shown);
    });

  relayRoute("/api/tapeout", "brain", BrainRelayPayload, (b) => relayer!.relay(b.line, b.lessons, b.instincts ?? 0, b.skills ?? []));
  relayRoute("/api/tapeout-child", "child", ChildRelayPayload, async (b) => {
    if ("parents" in b) return relayer!.relayChild({ parents: b.parents });
    const card = parseCard(b.card);
    if (!card?.family) return { ok: false, reason: "invalid", detail: "not a child's card" };
    return relayer!.relayChild({ family: card.family, lessons: card.lessons, ...(card.growth ? { growth: card.growth } : {}) });
  });
  relayRoute("/api/tapeout-instinct", "instinct", InstinctRelayPayload, (b) => relayer!.relayInstinct({ own: b.own, processor: b.processor as `0x${string}`, id: b.id }));

  return app;
}

function readEnvFile(path: string | undefined): Record<string, string> {
  if (!path) return {};
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

function makeRelayer(): BrainRelayer | null {
  const env = readEnvFile(process.env.LINGXI_RELAYER_KEY_FILE);
  const key = (env.DEPLOYER_PRIVATE_KEY ?? env.K) as `0x${string}` | undefined;
  const processor = process.env.LINGXI_PROCESSOR as `0x${string}` | undefined;
  if (!key || !processor) return null;
  const here = dirname(fileURLToPath(import.meta.url));
  return new BrainRelayer({
    rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech",
    processor,
    key,
    storeFile: process.env.LINGXI_BRAIN_STORE ?? resolve(here, "../data/brains.json"),
    maxPerDay: Number(process.env.LINGXI_RELAY_PER_DAY ?? 200),
    maxPerHour: Number(process.env.LINGXI_RELAY_PER_HOUR ?? 12),
    // OKB kept for season keepsakes (players' tape-outs stop above it); 0.01 OKB unless set
    reserveWei: BigInt(Math.round(Number(process.env.LINGXI_RELAY_RESERVE_OKB ?? 0.01) * 1e18)),
  });
}

/**
 * Serves the built site from the same origin as the API, with safe headers: the
 * landing page at /, the game at /play.html, the proof page at /verify.html.
 */
/** A Range in the only unit and syntax a file can answer: bytes, one or more N-M, N- or -N. */
const BYTE_RANGES = /^bytes=(\d+-\d*|-\d+)(\s*,\s*(\d+-\d*|-\d+))*$/;

/** How many folders' file servers, and pages' policies, the site keeps at once: releases come and go, memory stays bounded. */
export const SITE_CACHE_MAX = 64;

/** Where pages may load scripts from besides our own origin: Telegram's Mini App script and Cloudflare's analytics beacon. */
const SCRIPT_HOSTS = ["https://telegram.org", "https://static.cloudflareinsights.com"];

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
      const csp = [`script-src 'self' 'wasm-unsafe-eval' ${[...SCRIPT_HOSTS, ...hashes].join(" ")}`, "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", `frame-ancestors ${frames}`].join("; ");
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
    c.header("Cache-Control", c.res.status === 200 || c.res.status === 206 ? "public, max-age=31536000, immutable" : "no-store");
  });
  // one file server per folder, made the first time the folder is served from
  const servers = new Map<string, ReturnType<typeof serveStatic>>();
  const serverFor = (dir: string) => {
    let s = servers.get(dir);
    if (!s) {
      s = serveStatic({ root: relative(process.cwd(), dir) || ".", rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p) });
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
  return app;
}

/**
 * A refusal the app expects in normal play (rate limits, the daily tape-out
 * budget, a pet the history has not reached yet) answers 200 with ok:false, so
 * the player's browser shows our own message instead of logging a page error.
 * Malformed requests, which our client never sends, keep their 4xx codes.
 */
function busy(c: Context): Response {
  c.header("Retry-After", "60");
  return c.json({ ok: false, reason: "busy" });
}

/** The pet's voice: one line for what its circuit decided (cached per situation). */
export function withVoice(app: Hono, voice: ReturnType<typeof createVoice>, limiter = new RateLimiter(40, 600_000)): Hono {
  app.post("/api/voice", async (c) => {
    const ip = clientIp(c);
    // a missing line is normal (the pet falls back to its own words), so busy and
    // model hiccups answer 200 with ok:false rather than showing up as page errors
    if (!limiter.take(ip)) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, reason: "busy" });
    }
    if (Number(c.req.header("content-length") ?? 0) > 2048) return c.json({ ok: false, reason: "invalid" }, 413);
    let body;
    try {
      body = VoiceBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(await voice(body));
  });
  return app;
}

/** The lesson library: shared lessons, most learned first, with the pet that taught each first. */
/** Pet-sitting packs: leave a pet for a friend, collect it, send it home (the owner's game checks the return). */
export function withSitting(app: Hono, store: SittingStore, writes = new RateLimiter(30, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/sit", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > SEND_LIMITS.sitBodyBytes) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = SitLeaveBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(await store.leave(body.pack, body.keyHash, body.until, who(c)));
  });
  app.get("/api/sit/:code", async (c) => {
    const r = await store.collect(c.req.param("code"));
    return c.json(r ? { ok: true, ...r } : { ok: false, reason: "unknown" });
  });
  app.post("/api/sit/:code/home", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > SEND_LIMITS.sitBodyBytes) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = SitHomeBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json((await store.sendHome(c.req.param("code"), body.key, body.pet)) ? { ok: true } : { ok: false, reason: "refused" });
  });
  return app;
}

/** Arena snapshots: save the line fielded at a round; meet another player's line at the same round. */
export function withArena(app: Hono, store: ArenaStore, writes = new RateLimiter(120, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/arena/snapshot", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 16_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = ArenaSnapshotBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = store.save(body.round, body.pet, body.team, body.device);
    return c.json(r, r.ok ? 200 : 400);
  });
  app.get("/api/arena/opponent", (c) => {
    const q = ArenaOpponentQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ ok: false, reason: "invalid" }, 400);
    const s = store.pick(q.data.round, q.data.device);
    return c.json(s ? { ok: true, ...s } : { ok: false, reason: "none" });
  });
  return app;
}

/** Weekly seasons: enter this week with one tap; read any week's entries and standings. */
/** Proves an entry is a pet on X Layer (seasonProof.ts); without it, entries are open but cannot win the keepsake. */
export type SeasonProver = (pet: unknown, proof: SignedRelay) => Promise<{ ok: true; petId: string } | { ok: false; reason: string }>;

export function withSeason(app: Hono, store: SeasonStore, writes = new RateLimiter(30, 3_600_000), now: () => number = Date.now, prove?: SeasonProver): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/season/enter", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 16_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = SeasonEnterBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    // an entry that says it is a pet on X Layer must prove it; one that fails is refused, never entered unproven
    let petId: string | undefined;
    if (body.proof !== undefined) {
      if (!prove) return c.json({ ok: false, reason: "noProof", detail: "this server cannot check pets on chain" }, 503);
      const p = await prove(body.pet, body.proof as SignedRelay);
      // an expected answer in play (its mind on chain is behind, say), so 200 with the reason, like "full" and "busy"
      if (!p.ok) return c.json({ ok: false, reason: "notProven", detail: p.reason });
      petId = p.petId;
    }
    const r = store.enter(body.pet, body.device, { from: who(c), ...(petId ? { petId } : {}) });
    // a full week, or this address's share of it, is normal play: answer 200 so the page shows our own message.
    // `proven` is what the page may tell the player: never assumed from having sent a proof
    return c.json(r.ok ? { ...r, proven: !!petId } : r, r.ok || r.reason === "full" || r.reason === "tooMany" ? 200 : 400);
  });
  app.get("/api/season/:week", (c) => {
    const week = c.req.param("week") === "current" ? weekOf(now()) : c.req.param("week");
    const v = store.view(week);
    if (!v) return c.json({ ok: false, reason: "invalid" }, 400);
    // an open week changes with every entry, so it is never served from a cache
    c.header("Cache-Control", v.closed ? "public, max-age=3600" : "no-store");
    return c.json({ ok: true, ...v });
  });
  return app;
}

/** In-game mail: the letters current now, newest first. */
export function withMail(app: Hono, letters: () => readonly Letter[], now: () => number = Date.now): Hono {
  app.get("/api/mail", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ ok: true, letters: currentLetters(letters(), now()) });
  });
  return app;
}

export function withLibrary(app: Hono, library: Library, writes = new RateLimiter(60, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.get("/api/lessons", (c) => {
    c.header("Cache-Control", "public, max-age=30");
    return c.json({ ok: true, lessons: library.list(40) });
  });
  app.post("/api/lessons/share", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = LessonShareBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = library.share(body.rule, body.by, who(c), Date.now());
    return c.json(r, r.ok ? 200 : 400);
  });
  for (const action of ["use", "report"] as const) {
    app.post(`/api/lessons/${action}`, async (c) => {
      if (!writes.take(who(c))) return busy(c);
      let body;
      try {
        body = LessonKeyBody.parse(await c.req.json());
      } catch {
        return c.json({ ok: false, reason: "invalid" }, 400);
      }
      return c.json({ ok: library[action](body.key, who(c)) });
    });
  }
  return app;
}

/** A pet's history from the chain's events: hatching, daily saves, brain changes, family. */
export function withHistory(app: Hono, indexer: Indexer): Hono {
  app.get("/api/pets/:id/history", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,12}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    c.header("Cache-Control", "public, max-age=20");
    const h = indexer.history(id);
    return h ? c.json({ ok: true, indexedTo: indexer.head(), ...h }) : c.json({ ok: false, reason: "unknown", indexedTo: indexer.head() });
  });
  return app;
}

/** Who opened a red packet (A1): read from the claims index, never from a log query a public node would refuse. */
export function withPackets(app: Hono, index: Pick<PacketIndex, "claimsOf" | "head">): Hono {
  app.get("/api/packets/:id/claims", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,20}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    c.header("Cache-Control", "public, max-age=10");
    const p = index.claimsOf(id);
    return p ? c.json({ ok: true, indexedTo: index.head(), ...p }) : c.json({ ok: false, reason: "unknown", indexedTo: index.head() });
  });
  return app;
}

/**
 * The tree of life: every pet on chain with its generation, ancestors and the
 * owners who raised them. Names come from PetLook and name colours from the
 * extras contract (plan 4.9); both are remembered for ten minutes.
 */
export function withTree(app: Hono, indexer: Pick<Indexer, "pets" | "head">, nameOf?: (id: string) => Promise<string>, coloursOf?: (ids: string[]) => Promise<Record<string, number>>): Hono {
  const names = new Map<string, { name: string; at: number }>();
  const colours = new Map<string, { colour: number; at: number }>();
  const NAME_TTL = 10 * 60_000;
  app.get("/api/tree", async (c) => {
    const pets = indexer.pets();
    if (nameOf) {
      const stale = pets.filter((p) => (names.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL).slice(0, 50);
      await Promise.all(stale.map(async (p) => names.set(p.id, { name: await nameOf(p.id).catch(() => names.get(p.id)?.name ?? ""), at: Date.now() })));
    }
    if (coloursOf) {
      const stale = pets.filter((p) => (colours.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL).slice(0, 200).map((p) => p.id);
      if (stale.length) {
        const got = await coloursOf(stale).catch(() => null);
        if (got) for (const id of stale) colours.set(id, { colour: got[id] ?? 0, at: Date.now() });
      }
    }
    const tree = buildTree(
      pets.map((p) => {
        const name = names.get(p.id)?.name;
        const colour = colours.get(p.id)?.colour;
        return { ...p, ...(name ? { name } : {}), ...(colour ? { colour } : {}) };
      }),
    );
    c.header("Cache-Control", "public, max-age=30");
    return c.json({ ok: true, indexedTo: indexer.head(), ...tree });
  });
  return app;
}

/**
 * Public diaries: owners publish the log their pet's checkpoint committed to; it is kept only if it
 * hashes to the log hash on chain, and anyone may read it (read-only, any origin).
 */
export function withDiaries(app: Hono, store: DiaryStore, logHashOf: (id: string) => Promise<string | null>): Hono {
  const limiter = new RateLimiter(20, 60 * 60_000);
  app.get("/api/pets/:id/log", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,12}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    const log = store.get(id);
    c.header("Cache-Control", "public, max-age=30");
    return log ? c.json({ ok: true, log }) : c.json({ ok: false, reason: "none" });
  });
  app.post("/api/pets/:id/log", async (c) => {
    const ip = clientIp(c);
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy" }, 429);
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const published = PublishedLog.safeParse(body);
    if (!published.success || published.data.petId !== id) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = store.publish(published.data, await logHashOf(id).catch(() => null));
    return c.json(r, r.ok ? 200 : r.reason === "invalid" ? 400 : 409);
  });
  return app;
}

/** Moving pets between Telegram and a browser: a one-time code, claimed once within minutes. */
export function withMove(app: Hono, store: MoveStore, limiter = new RateLimiter(20, 60 * 60_000)): Hono {
  const ipOf = (c: Context) => clientIp(c);
  app.post("/api/move", async (c) => {
    if (!limiter.take(ipOf(c))) return c.json({ ok: false, reason: "busy" }, 429);
    if (Number(c.req.header("content-length") ?? 0) > MAX_MOVE_CHARS * 2) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const move = MoveBody.safeParse(body);
    if (!move.success) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = store.put(move.data.save, ipOf(c));
    return c.json(r, r.ok ? 200 : r.reason === "invalid" ? 400 : r.reason === "tooBig" ? 413 : 503);
  });
  app.post("/api/move/:code/claim", (c) => {
    if (!limiter.take(ipOf(c))) return c.json({ ok: false, reason: "busy" }, 429);
    const code = c.req.param("code");
    if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return c.json({ ok: false, reason: "invalid" }, 400);
    const save = store.take(code);
    c.header("Cache-Control", "no-store");
    // a used or expired code is an answer, not an error: the page explains it
    return c.json(save ? { ok: true, save } : { ok: false, reason: "gone" });
  });
  return app;
}

/** Reminder routes: the public key to subscribe with, a plan of upcoming reminders, and stop. */
export function withPush(app: Hono, pusher: Pusher, limiter = new RateLimiter(30, 3_600_000)): Hono {
  app.get("/api/push/key", (c) => c.json({ key: pusher.publicKey }));
  app.post("/api/push/plan", async (c) => {
    const ip = clientIp(c);
    if (!limiter.take(ip)) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 4096) return c.json({ ok: false, reason: "invalid" }, 413);
    let body;
    try {
      body = PushPlanBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = pusher.plan(body, Date.now());
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/push/stop", async (c) => {
    let endpoint: string;
    try {
      endpoint = PushStopBody.parse(await c.req.json()).endpoint;
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json({ ok: true, stopped: pusher.stop(endpoint) });
  });
  return app;
}

/** Reminders, when a key file (VAPID_PUBLIC / VAPID_PRIVATE / VAPID_SUBJECT) is configured. */
function makePusher(): Pusher | null {
  const file = process.env.LINGXI_PUSH_KEY_FILE;
  if (!file) return null;
  const env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return null;
  return createPusher({ publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: env.VAPID_SUBJECT ?? "https://lingxi.knole.me", store: process.env.LINGXI_PUSH_STORE });
}

/** The last daily backup (deploy/backup.mjs): how old it is and whether both copies were made. */
function backupStatus(): { ageHours: number; local: boolean; drive: boolean; error: string | null } | null {
  try {
    const file = process.env.LINGXI_BACKUP_STATUS ?? join(homedir(), "lingxi-backups", "last.json");
    const s = JSON.parse(readFileSync(file, "utf8")) as { at: string; local: boolean; drive: boolean; error: string | null };
    return { ageHours: Math.round(((Date.now() - Date.parse(s.at)) / 3_600_000) * 10) / 10, local: s.local, drive: s.drive, error: s.error };
  } catch {
    return null;
  }
}

/** The watchdog's last beat (deploy/watchdog.mjs): how old it is, what it saw, and the last thing it restarted. */
function watchdogStatus(): { ageSeconds: number; local: boolean; public: boolean; last: { action: string | null; at: string | null; result: string | null } } | null {
  try {
    const file = process.env.LINGXI_WATCHDOG_STATUS ?? join(homedir(), "lingxi-watchdog.json");
    const s = JSON.parse(readFileSync(file, "utf8")) as { at: string; local: boolean; public: boolean; last: { action: string | null; at: string | null; result: string | null } };
    return { ageSeconds: Math.round((Date.now() - Date.parse(s.at)) / 1000), local: s.local, public: s.public, last: s.last };
  } catch {
    return null;
  }
}

/** Sizes of the server's data files and folders, in KB, so a store growing without bound shows before it hurts. */
function storeSizes(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  const sizeOf = (p: string): number => {
    const st = statSync(p);
    return st.isDirectory() ? readdirSync(p).reduce((n, f) => n + sizeOf(join(p, f)), 0) : st.size;
  };
  try {
    for (const f of readdirSync(dir)) out[f] = Math.round(sizeOf(join(dir, f)) / 1024);
  } catch {
    // no data folder yet
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // a stray rejection is logged and the server keeps serving; an exception means state may be broken, so it exits and
  // pm2 starts it clean (every timer runs through `jobs`, which catches its own errors, so neither should happen)
  process.on("unhandledRejection", (e) => process.stderr.write(`unhandled rejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`));
  process.on("uncaughtException", (e) => {
    process.stderr.write(`uncaught exception: ${e.stack ?? e.message}\n`);
    process.exit(1);
  });
  const jobs = createJobs();
  const key = loadKey();
  // teaching and voices share one daily token budget, kept on disk so a restart does not reset it (tokenBudget.ts)
  const modelBudget = createTokenBudget({ perDay: Number(process.env.LINGXI_MODEL_TOKENS_PER_DAY ?? 2_000_000), file: resolve(dirname(fileURLToPath(import.meta.url)), "../data/model-budget.json") });
  const client = key ? budgetedClient(new Anthropic({ apiKey: key }), modelBudget) : null;
  const port = Number(process.env.PORT ?? 8787);
  // the deployment the game runs on, read once: the agent API, adoption papers and what visitors see all use it
  const rpcMain = process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech";
  let chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  try {
    const file = process.env.LINGXI_DEPLOYMENT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/chain/deployments/xlayer.json");
    const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
    chainCtx = { pub: createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [rpcMain] } } }, transport: http(rpcMain) }) as PublicClient, deployment };
  } catch (e) {
    process.stderr.write(`no chain reads: ${(e as Error).message}\n`);
  }
  // every contract address and start block not set by hand comes from the deployment record, so a fresh clone indexes
  // the same chain the live site does with no configuration
  if (chainCtx) {
    const d = chainCtx.deployment;
    const fromRecord: Record<string, string | number | undefined> = {
      LINGXI_PROCESSOR: d.processor,
      LINGXI_REGISTRY: d.registry,
      LINGXI_REGISTRY_FROM: d.registryBlock,
      LINGXI_LOOK: d.look,
      LINGXI_MARKET_OKB: d.outfitMarket,
      LINGXI_MARKET_OKB_FROM: d.outfitMarketBlock,
      LINGXI_MARKET_BEM: d.outfitMarketV2,
      LINGXI_MARKET_BEM_FROM: d.outfitMarketV2Block,
      LINGXI_BREEDER: d.breeder,
      LINGXI_GIFT: d.holderGift,
      LINGXI_ITEM_SHOP: d.itemShop,
      LINGXI_ADOPTION: d.adoptionCentre,
      LINGXI_EXTRAS: d.extras,
    };
    for (const [key, value] of Object.entries(fromRecord)) if (process.env[key] === undefined && value !== undefined) process.env[key] = String(value);
  }
  // made after the record is read: it tapes out on the deployment's processor
  const relayer = makeRelayer();
  // homes (plan 4.9): what visitors see is what the home's linked wallets hold on X Layer
  const homeChain: HomeChain | undefined = chainCtx && {
    roomPacks: async (wallets) => (await packsHeld(chainCtx!.pub, chainCtx!.deployment, wallets)).room,
    piecesHeld: (wallets) => piecesHeld(chainCtx!.pub, chainCtx!.deployment, wallets),
    ownerOf: async (id) => (await chainCtx!.pub.readContract({ address: chainCtx!.deployment.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [id] })) as `0x${string}`,
    nameColour: async (id) => (await nameColours(chainCtx!.pub, chainCtx!.deployment, [id]))[id.toString()] ?? 0,
  };
  const live = new LiveRooms(createDecorStore(process.env.LINGXI_DECOR_STORE), createHomes({ ...(homeChain ? { chain: homeChain } : {}), file: process.env.LINGXI_HOMES_STORE }));
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // what /api/health reports beyond its switches; chain reads are cached so a busy health check costs nothing
  const watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number } = {};
  let cached: { at: number; value: Record<string, unknown> } | null = null;
  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../data");
  const detail: HealthDetail = async () => {
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const [head, relayerWei] = await Promise.all([watch.head?.().catch(() => null) ?? null, relayer?.balance().catch(() => null) ?? null]);
    const value = {
      jobs: Object.fromEntries(jobs.status().map((j) => [j.name, j.healthy ? "ok" : `failing: ${j.lastError?.message ?? "?"}`])),
      indexerLagBlocks: head !== null && watch.indexed ? Number(head) - watch.indexed() : null,
      packetsLagBlocks: head !== null && watch.packets ? Number(head) - watch.packets() : null,
      relayerOkb: relayerWei === null ? null : Number(relayerWei) / 1e18,
      // the alarm the outside check turns into an issue for Prateek: top the relayer up before players are refused
      relayerLow: relayerWei !== null && Number(relayerWei) / 1e18 < Number(process.env.LINGXI_RELAY_ALARM_OKB ?? 0.02),
      relayerUsage: relayer?.usage() ?? null,
      modelTokensToday: client ? { used: modelBudget.used(), perDay: modelBudget.perDay } : null,
      backup: backupStatus(),
      watchdog: watchdogStatus(),
      // the process's own memory, in MB: a store or cache growing without end shows here first
      memoryMb: Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1e5) / 10])),
      storesKb: storeSizes(dataDir),
    };
    cached = { at: Date.now(), value };
    return value;
  };
  // who may keep a pet, read from PetRegistry on X Layer at the moment of the request
  const isKeeper: KeeperCheck | undefined = chainCtx
    ? async (petId, who) => (await chainCtx!.pub.readContract({ address: chainCtx!.deployment.registry, abi: petRegistryAbi, functionName: "isKeeper", args: [BigInt(petId), who] })) as boolean
    : undefined;
  const app = createApp(client, undefined, relayer, undefined, live, detail, isKeeper);
  if (client) withVoice(app, createVoice(client));
  withLibrary(app, createLibrary(process.env.LINGXI_LIBRARY_STORE));
  withSitting(app, createSittingStore(process.env.LINGXI_SIT_STORE));
  withArena(app, createArenaStore(process.env.LINGXI_ARENA_STORE));
  {
    // letters ship with the server; a redeploy brings new ones
    const file = process.env.LINGXI_MAIL_FILE ?? resolve(dirname(fileURLToPath(import.meta.url)), "../mail/letters.json");
    const letters = loadLetters(file);
    withMail(app, () => letters);
  }
  const seasons = createSeasonStore(process.env.LINGXI_SEASON_STORE);
  // proving an entry is a pet on X Layer: its keeper's signature, and its card thinks as its brain on chain does
  const seasonNonces = createNonceBook();
  const prove: SeasonProver | undefined =
    chainCtx && isKeeper
      ? (pet, proof) =>
          proveSeasonEntry(pet, proof, {
            isKeeper,
            now: Date.now,
            nonces: seasonNonces,
            brainOf: async (id) => {
              const onChain = await readPet(chainCtx!.pub, chainCtx!.deployment, BigInt(id));
              const circuit = await loadCircuitFromChain(chainCtx!.pub, onChain.processor, onChain.brainId);
              return { fast: circuitBrain(circuit), nState: circuit.nState };
            },
          })
      : undefined;
  withSeason(app, seasons, undefined, undefined, prove);
  {
    // the open agent API reads pets from the deployment the game runs on
    const rpc = rpcMain;
    const chain = chainCtx;
    withAgentApi(app, { agents: createAgentStore(process.env.LINGXI_AGENT_STORE), seasons, ...(chain ? { chain } : {}) });
    // the browser's door to X Layer: same origin, so a rate-limited public RPC can never look like a blocked request
    // on mainnet the door reads from X Layer's other official host than the one our jobs read from, with the jobs'
    // host as a small reserve; any other node (a local fork) serves both
    const official = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
    withRpcProxy(app, official.includes(rpc) ? { upstreams: official.filter((u) => u !== rpc), reserve: { url: rpc, perMinute: 60 } } : { upstreams: [rpc] });
    // adoption papers (plan 4.8): posted by the owner of a pet on offer, fetched by the buyer's game
    if (chain?.deployment.adoptionCentre) {
      const { pub, deployment } = chain;
      withPapers(app, createPapersStore(process.env.LINGXI_PAPERS_STORE), {
        ownerOf: async (id) => (await pub.readContract({ address: deployment.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [id] })) as `0x${string}`,
        sellerOf: async (id) => {
          const row = (await pub.readContract({ address: deployment.adoptionCentre!, abi: adoptionCentreAbi, functionName: "listings", args: [id] })) as readonly [`0x${string}`, bigint, bigint, `0x${string}`];
          return /^0x0{40}$/i.test(row[0]) ? null : row[0];
        },
      });
    }
    withMove(app, createMoveStore());
    // R2: Little Mars counts today's tape-outs across every X Layer processor
    const lane = createTapeoutCounter(factoryReader(rpc), process.env.LINGXI_LANE_FILE);
    withLane(app, lane);
    jobs.every("lane count", 5 * 60_000, () => lane.tick(), { now: true });
    if (chain) withDiaries(app, createDiaryStore(process.env.LINGXI_DIARY_DIR), async (id) => (await readPet(chain!.pub, chain!.deployment, BigInt(id))).logHash);
  }
  if (relayer) {
    // a finished week's champion gets its brain taped out and sent to its wallet (PRD F26)
    const giveKeepsakes = () =>
      settleAwards(seasons, async (entry, petId) => {
        const card = parseCard(entry.pet.card);
        if (!card) return { ok: false, detail: "damaged card" };
        // the keepsake goes to whoever owns the proven pet now, read on chain at the moment it is sent
        if (!chainCtx) return { ok: false, detail: "no chain reads" };
        const to = (await chainCtx.pub.readContract({ address: chainCtx.deployment.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [BigInt(petId)] })) as `0x${string}`;
        const r = await relayer.keepsake({ line: entry.pet.line, lessons: card.lessons, instincts: card.instincts, family: card.family, growth: card.growth }, to);
        if (!r.ok) process.stderr.write(`season keepsake failed: ${r.reason} ${r.detail ?? ""}\n`);
        return r.ok ? { ok: true, brainId: r.brainId, to, tapeTx: r.tapeTx, sendTx: r.sendTx } : { ok: false, detail: r.detail };
      });
    jobs.after("season keepsakes (first)", 30_000, giveKeepsakes);
    jobs.every("season keepsakes", 10 * 60_000, giveKeepsakes);
  }
  if (process.env.LINGXI_REGISTRY && process.env.LINGXI_REGISTRY_FROM) {
    const indexer = createIndexer({ rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", registry: process.env.LINGXI_REGISTRY as `0x${string}`, fromBlock: Number(process.env.LINGXI_REGISTRY_FROM), store: process.env.LINGXI_HISTORY_STORE });
    withHistory(app, indexer);
    watch.indexed = () => indexer.head();
    const headClient = createPublicClient({ transport: http(process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", { timeout: 10_000 }) });
    watch.head = () => headClient.getBlockNumber({ cacheTime: 0 });
    const look = process.env.LINGXI_LOOK as `0x${string}` | undefined;
    const lookClient = createPublicClient({ transport: http(process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", { timeout: 10_000 }) });
    withTree(
      app,
      indexer,
      look ? async (id) => String(await lookClient.readContract({ address: look, abi: lookAbi, functionName: "nameOf", args: [BigInt(id)] })) : undefined,
      chainCtx?.deployment.extras ? (ids) => nameColours(chainCtx!.pub, chainCtx!.deployment, ids.map((x) => BigInt(x))) : undefined,
    );
    jobs.loop("indexer", () => indexer.catchUp(), 15_000);
    // who opened each red packet (A1): the contract keeps only events, read here in 100-block windows
    if (chainCtx?.deployment.redPacket && chainCtx.deployment.redPacketBlock) {
      const packets = createPacketIndex({
        rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech",
        address: chainCtx.deployment.redPacket as `0x${string}`,
        fromBlock: Number(process.env.LINGXI_PACKETS_FROM ?? chainCtx.deployment.redPacketBlock),
        store: process.env.LINGXI_PACKETS_STORE ?? join(dataDir, "packets.json"),
      });
      withPackets(app, packets);
      watch.packets = () => packets.head();
      jobs.loop("packets", () => packets.catchUp(), 20_000);
    }
    // live numbers: the pet counts above, both markets' sales, and the contracts' own totals
    const rpc = process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech";
    const env = (k: string) => (process.env[k] ? (process.env[k] as `0x${string}`) : undefined);
    const markets = [
      { address: env("LINGXI_MARKET_OKB"), fromBlock: Number(process.env.LINGXI_MARKET_OKB_FROM ?? 0) },
      { address: env("LINGXI_MARKET_BEM"), fromBlock: Number(process.env.LINGXI_MARKET_BEM_FROM ?? 0) },
    ].filter((m): m is { address: `0x${string}`; fromBlock: number } => !!m.address && m.fromBlock > 0);
    const sales = createSalesCounter({ rpc, markets, store: process.env.LINGXI_SALES_STORE });
    jobs.loop("sales", () => sales.catchUp(), 20_000);
    withNumbers(app, {
      pub: createPublicClient({ transport: http(rpc, { timeout: 15_000 }) }),
      counts: (since) => indexer.counts(since),
      petsIndexedTo: () => indexer.head(),
      sales,
      contracts: { registry: process.env.LINGXI_REGISTRY as `0x${string}`, marketOkb: env("LINGXI_MARKET_OKB"), marketBem: env("LINGXI_MARKET_BEM"), breeder: env("LINGXI_BREEDER"), gift: env("LINGXI_GIFT"), itemShop: env("LINGXI_ITEM_SHOP"), adoption: env("LINGXI_ADOPTION"), extras: env("LINGXI_EXTRAS") ?? chainCtx?.deployment.extras },
      explorer: "https://www.oklink.com/xlayer",
    });
    // community goals: every contribution read from the registry and every BEM burner
    const burners = [env("LINGXI_BREEDER"), env("LINGXI_MARKET_BEM"), env("LINGXI_ITEM_SHOP"), env("LINGXI_ADOPTION"), env("LINGXI_EXTRAS") ?? chainCtx?.deployment.extras].filter((a): a is `0x${string}` => !!a);
    const ledger = createGoalLedger({ rpc, registry: process.env.LINGXI_REGISTRY as `0x${string}`, burners, fromBlock: Number(process.env.LINGXI_REGISTRY_FROM), store: process.env.LINGXI_GOALS_STORE });
    withGoals(app, ledger);
    // keepsake vouchers (plan 4.6): signed only for contributors to a completed goal, with the voucher key
    const voucherKey = readEnvFile(process.env.LINGXI_VOUCHER_KEY_FILE).VOUCHER_PRIVATE_KEY;
    if (voucherKey) {
      try {
        const file = process.env.LINGXI_DEPLOYMENT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/chain/deployments/xlayer.json");
        const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
        withVouchers(app, { entries: () => ledger.entries(), signer: privateKeyToAccount(voucherKey as `0x${string}`), deployment });
      } catch (e) {
        process.stderr.write(`vouchers off: ${(e as Error).message}
`);
      }
    }
    jobs.loop("goals", () => ledger.catchUp(), 20_000);
  }
  const pusher = makePusher();
  if (pusher) {
    withPush(app, pusher);
    jobs.every("reminders", 60_000, () => pusher.tick(Date.now()));
  }
  // the site: the live release of a releases folder (A10), or one folder as it is
  if (process.env.LINGXI_SITE) withSite(app, releaseSource(process.env.LINGXI_SITE));
  else if (process.env.LINGXI_STATIC) withSite(app, process.env.LINGXI_STATIC);
  // loopback only: the world reaches it through the Cloudflare tunnel, so no one can send a request around it with a
  // forged cf-connecting-ip (see clientIp.ts)
  const hostname = process.env.LINGXI_HOST ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname });
  attachLive(server, live, origins);
  process.stdout.write(`lingxi api on ${hostname}:${port} (teaching ${client ? "on" : "off: no key"}, relaying ${relayer ? "on" : "off"}, reminders ${pusher ? "on" : "off"})\n`);
}
