/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
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
import { SponsorGate } from "./sponsor";
import { RelayQuota, checkRelayAuth, createNonceBook } from "./relayGate";
import { LiveRooms, attachLive } from "./live";
import { createDecorStore } from "./decor";
import { type SittingStore, createSittingStore } from "./sitting";
import { type ArenaStore, createArenaStore } from "./arena";
import { type SeasonStore, createSeasonStore, settleAwards } from "./season";
import { dayIndex, weekOf } from "@lingxi/game";
import { parseCard } from "@lingxi/game";
import { createPublicClient, custom, fallback, http, parseEther, type Address, type PublicClient } from "viem";
import { FACTORY, type Deployment, type SignedRelay, adoptionCentreAbi, createNetlistCache, holderGiftAbi, loadCircuitFromChain, nameColours, packsHeld, petRegistryAbi, piecesHeld, readPet, xLayer } from "@lingxi/chain";
import { type HomeChain, createHomes } from "./homes";
import { createAgentStore } from "./agents";
import { withAgentApi } from "./agentApi";
import { withTapApi } from "./tapApi";
import { TEST1_REFRESH_MS, createTest1Index, withTest1Owners } from "./test1Owners";
import { handleMcp, withMcp } from "./mcp";
import { MCP_TOOLS } from "./mcpToolDefs";
import { type Letter, currentLetters, loadLetters } from "./mail";
import { createPusher, type Pusher } from "./push";
import { createVoice } from "./voice";
import { createLibrary, type Library } from "./library";
import { createIndexer, type Indexer } from "./indexer";
import { createPacketIndex, type PacketIndex } from "./packets";
import { createGoalLedger, withGoals } from "./goals";
import { withVouchers } from "./voucher";
import { createPapersStore, withPapers } from "./papers";
import { readdir, stat } from "node:fs/promises";
import { createMindChecker } from "./mindCheck";
import { createConsentIndex, withConsents } from "./consents";
import { withReadLimits } from "./readLimits";
import { budgetedRequest } from "./visitorBudget";
import { createSourcifyRelay, withSourcify } from "./sourcify";
import { withRpcProxy } from "./rpc";
import { privateKeyToAccount } from "viem/accounts";
import { type EarningTerms, createSalesCounter, withNumbers } from "./numbers";
import { createRefScanner } from "./refScan";
import { createListingWatch, withRetiredListings } from "./marketV1";
import { createDuelStore, withDuels } from "./duels";
import { createDailyBlocks, withDaily } from "./daily";
import { createStandingsRunner } from "./standings";
import { buildTree } from "./tree";
import { type DiaryStore, type PetOnChain, createDiaryStore } from "./diaries";
import { type LogHasher, createLogHasher } from "./logHash";
import { type MoveStore, createMoveStore } from "./move";
import { createTapeoutCounter, withLane } from "./lane";
import { factoryReader } from "./laneReader";
import { petLookAbi as lookAbi } from "@lingxi/chain";
import { clientIp, directLocal } from "./clientIp";
import { withBodyLimits } from "./bodyLimits";
import { proveSeasonEntry } from "./seasonProof";
import { budgetedClient, createTokenBudget, modelCaller } from "./tokenBudget";
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
/** A pet's brain on chain and its parents (null when it was hatched, not born), or null when there is no such pet (A75). */
export type PetOnChainReader = (petId: string) => Promise<{ brainId: string; parents: [string, string] | null } | null>;
/** Whether a pet has standing on chain (PetRegistry.isSettled): sponsored tape-outs go first to such pets (A40). */
export type SettledCheck = (petId: string) => Promise<boolean>;

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
  // with no chain to ask (tests), every pet counts as settled
  isSettled: SettledCheck = async () => true,
  // a pet's brain and parents on chain (A75); with no chain to ask (tests), the relay's own checks only
  petOnChain?: PetOnChainReader,
) {
  const app = new Hono();
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // the agent API, and a pet's public log and history, are open to any origin; the rest answers only the game's pages
  // every write is held to its route's size before a byte of it is parsed (bodyLimits.ts)
  withBodyLimits(app);
  // and every heavy read is limited per caller (readLimits.ts, A78)
  withReadLimits(app);
  app.use("/api/*", cors({ origin: (o, c) => (c.req.path.startsWith("/api/v1") || (c.req.method === "GET" && /^\/api\/pets\/\d+\/(log|history)$/.test(c.req.path)) ? "*" : origins.includes(o) ? o : null), allowMethods: ["GET", "POST"], allowHeaders: ["Authorization", "Content-Type"], maxAge: 600 }));

  // the parts are booleans (true when on), for anyone; `detail` (balances, usage, memory, stores) is everything else
  // worth watching, and goes only to a request made on this machine directly: the status check (A64)
  app.get("/api/health", async (c) => c.json({ ok: true, teach: client !== null, voice: client !== null, relay: relayer !== null, live: live !== null, ...(detail && directLocal(c) ? { detail: await detail() } : {}) }));
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
    // every model call this lesson makes is charged to the address that asked (A53)
    const result = await modelCaller.run(ip, () => teachInWords(client, { words: body.words, ...(body.name !== undefined ? { name: body.name } : {}), stage: body.stage, mind }));
    return result.ok || result.reason !== "busy" ? c.json(result) : busy(c);
  });

  // every relay request is the signed form (see relayGate.ts and @lingxi/chain's relayAuth.ts); its payload is the
  // route's own schema
  const nonces = createNonceBook();
  const refusalStatus: Record<string, 401 | 403 | 429> = { unsigned: 401, expired: 401, badSignature: 401, replayed: 401, notKeeper: 403, busy: 429 };

  /** The shared path of the three relay routes: who asked, how often, and what they asked for. */
  const relayRoute = <T,>(path: string, kind: "brain" | "child" | "instinct", schema: z.ZodType<T>, act: (body: T, petId: string) => Promise<RelayResult>, most: (body: T) => number = () => 1) =>
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
      // the slot is taken before the tape-out, so a burst cannot pass a cap; it is given back when nothing was sent (A40)
      // as many slots as this request may send tape-outs, all at once; those it does not send come back (A75)
      const slot = quota.take(req.petId, gate.signer, await isSettled(req.petId).catch(() => false), Date.now(), most(body));
      if (!slot.ok) return slot.reason === "busy" ? busy(c) : c.json({ ok: false, reason: slot.reason });
      let result: RelayResult;
      try {
        result = await act(body, req.petId);
      } catch (e) {
        quota.refund(slot.ticket);
        throw e;
      }
      // charged for every tape-out sent; a brain already taped out, or a refusal before sending, costs nothing
      const sent = result.sent ?? ((result.ok && !result.reused) || (!result.ok && result.spent) ? 1 : 0);
      quota.refund(slot.ticket, slot.ticket.n - Math.min(sent, slot.ticket.n));
      const { spent: _spent, sent: _sent, ...shown } = result as RelayResult & { spent?: boolean };
      return c.json(shown);
    });

  relayRoute("/api/tapeout", "brain", BrainRelayPayload, (b) => relayer!.relay(b.line, b.lessons, b.instincts ?? 0, b.skills ?? []));
  relayRoute(
    "/api/tapeout-child",
    "child",
    ChildRelayPayload,
    async (b, petId) => {
      // only for this pet as the chain has it: a birth's first parent is its own brain, a taught child's card a child's (A75)
      const pet = petOnChain ? await petOnChain(petId).catch(() => undefined) : null;
      if (pet === undefined) return { ok: false, reason: "error", detail: "X Layer could not be read" };
      if (petOnChain && pet === null) return { ok: false, reason: "invalid", detail: "no such pet" };
      if ("parents" in b) {
        if (pet && pet.brainId !== b.parents[0]) return { ok: false, reason: "invalid", detail: "the first parent is not this pet's brain" };
        return relayer!.relayChild({ parents: b.parents });
      }
      if (pet && !pet.parents) return { ok: false, reason: "invalid", detail: "this pet is not a child" };
      const card = parseCard(b.card);
      if (!card?.family) return { ok: false, reason: "invalid", detail: "not a child's card" };
      return relayer!.relayChild({ family: card.family, lessons: card.lessons, ...(card.growth ? { growth: card.growth } : {}) });
    },
    // a taught child's two halves and its glue; a birth's glue alone
    (b) => ("parents" in b ? 1 : 3),
  );
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
    let body;
    try {
      body = VoiceBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(await modelCaller.run(ip, () => voice(body)));
  });
  return app;
}

/** The lesson library: shared lessons, most learned first, with the pet that taught each first. */
/** Pet-sitting packs: leave a pet for a friend, collect it, send it home (the owner's game checks the return). */
export function withSitting(app: Hono, store: SittingStore, writes = new RateLimiter(30, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/sit", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = SitLeaveBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(await store.leave(body.pack, body.keyHash, body.until, who(c)));
  });
  app.get("/api/sit/:code", async (c) => {
    // the code is the pack's key: never kept by a shared cache; heavy, so limited per caller (A119)
    c.header("Cache-Control", "no-store");
    const r = await store.collect(c.req.param("code"));
    return c.json(r ? { ok: true, ...r } : { ok: false, reason: "unknown" });
  });
  app.post("/api/sit/:code/home", async (c) => {
    if (!writes.take(who(c))) return busy(c);
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
    let body;
    try {
      body = ArenaSnapshotBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = store.save(body.round, body.pet, body.team, body.device, clientIp(c));
    // a sender past its share of the round is an answer, not an error (A144)
    return c.json(r, r.ok || r.reason === "busy" ? 200 : 400);
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
  // each week's answer is written once per change of it and served from that text (A78): a week's season carries
  // every entry's card, and writing it out again for every read took the request thread
  const written = new Map<string, { of: unknown; standings: unknown; closed: boolean; award: unknown; pending: unknown; text: string }>();
  app.get("/api/season/:week", (c) => {
    const week = c.req.param("week") === "current" ? weekOf(now()) : c.req.param("week");
    const v = store.view(week);
    if (!v) return c.json({ ok: false, reason: "invalid" }, 400);
    // an open week changes with every entry, so it is never served from a cache
    c.header("Cache-Control", v.closed ? "public, max-age=3600" : "no-store");
    const held = written.get(week);
    const same = held && held.of === v.entries && held.standings === v.standings && held.closed === v.closed && held.award === v.award && held.pending === v.pending;
    const text = same ? held.text : JSON.stringify({ ok: true, ...v });
    if (!same) {
      written.set(week, { of: v.entries, standings: v.standings, closed: v.closed, award: v.award, pending: v.pending, text });
      if (written.size > 8) written.delete(written.keys().next().value!);
    }
    c.header("content-type", "application/json; charset=utf-8");
    return c.body(text);
  });
  return app;
}

/** What the sponsor route needs: who may ask (sponsor.ts), the relayer that sends, and the deployment it sends to. */
export interface Sponsoring {
  gate: SponsorGate;
  relayer: Pick<BrainRelayer, "sponsorHatch" | "sponsorGrant">;
  deployment: Deployment;
  who: (c: Context) => string;
}

/**
 * Each refusal's status. One that is normal play (switched off, already had, the network's pet today, the day's budget
 * spent, a request already on its way, the OKB held for keepsakes) answers 200 with its reason, like the tape-out's
 * "newcomer", so the page shows its own message and the browser logs no error (B9); a malformed, forged or stale
 * request, or a failed send, keeps its error status.
 */
const SPONSOR_STATUS: Record<string, 200 | 400 | 401 | 502> = { off: 200, invalid: 400, expired: 401, badSignature: 401, had: 200, busy: 200, network: 200, budget: 200, relayLow: 200, error: 502 };

/**
 * A pet kept on X Layer for a player with no wallet (H4): the relayer hatches it to their device key and sends that
 * key its gas. Off unless the server is switched on for it; every refusal is named and sends nothing.
 */
export function withSponsor(app: Hono, s: Sponsoring | null, limiter = new RateLimiter(20, 3_600_000)): Hono {
  app.get("/api/sponsor", (c) => c.json({ ok: true, on: !!s?.gate.enabled }, 200, { "cache-control": "no-store" }));
  // what was kept for a device key, so a game whose answer was lost on the way can find its pet (X Layer confirms it)
  app.get("/api/sponsor/of/:address", (c) => {
    const to = c.req.param("address").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(to)) return c.json({ ok: false, reason: "invalid", detail: "bad address" }, 400);
    const p = s?.gate.pets().find((x) => x.to === to && x.petId !== null);
    return p ? c.json({ ok: true, petId: p.petId, hatchTx: p.hatchTx, grantTx: p.grantTx }) : c.json({ ok: false, reason: "none", detail: "nothing kept for this address" }, 404);
  });
  app.post("/api/sponsor/hatch", async (c) => {
    if (!s || !s.gate.enabled) return c.json({ ok: false, reason: "off", detail: "keeping a pet without a wallet is not switched on" }, 200);
    const ip = s.who(c);
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy", detail: "too many requests; try again later" }, 429);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const r = await s.gate.check(body, ip);
    if (!r.ok) return c.json({ ok: false, reason: r.reason, detail: r.detail }, SPONSOR_STATUS[r.reason] ?? 400);
    const slot = r.slot;
    try {
      if (r.retryGrant) {
        const g = await s.relayer.sponsorGrant(slot.to as Address);
        if (!g.ok) {
          s.gate.release(slot);
          return c.json({ ok: false, reason: g.reason, detail: g.detail }, SPONSOR_STATUS[g.reason] ?? 502);
        }
        s.gate.finish(slot, { petId: slot.petId, hatchTx: null, grantTx: g.grantTx, spentWei: g.spentWei });
        return c.json({ ok: true, petId: slot.petId, hatchTx: null, grantTx: g.grantTx });
      }
      const h = await s.relayer.sponsorHatch(s.deployment, slot.to as Address, slot.line, slot.state);
      if (!h.ok) {
        // a hatch that cost gas is kept, so the day's count holds it; one that sent nothing gives its slot back
        if (h.spent) s.gate.finish(slot, { petId: null, hatchTx: null, grantTx: null, ...(h.spentWei !== undefined ? { spentWei: h.spentWei } : {}) });
        else s.gate.release(slot);
        return c.json({ ok: false, reason: h.reason, detail: h.detail }, SPONSOR_STATUS[h.reason] ?? 502);
      }
      s.gate.finish(slot, { petId: h.petId, hatchTx: h.hatchTx, grantTx: h.grantTx, spentWei: h.spentWei });
      return c.json({ ok: true, petId: h.petId, hatchTx: h.hatchTx, grantTx: h.grantTx });
    } catch (e) {
      s.gate.release(slot);
      throw e;
    }
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

/** The most pets one page of the tree holds (A147). */
const TREE_PAGE_MAX = 1_000;

/**
 * The tree of life: every pet on chain with its generation, ancestors and the
 * owners who raised them. Names come from PetLook and name colours from the
 * extras contract (plan 4.9); both are remembered for ten minutes.
 */
export function withTree(app: Hono, indexer: Pick<Indexer, "pets" | "head">, nameOf?: (id: string) => Promise<string>, coloursOf?: (ids: string[]) => Promise<Record<string, number>>): Hono {
  const names = new Map<string, { name: string; at: number }>();
  const colours = new Map<string, { colour: number; at: number }>();
  const NAME_TTL = 10 * 60_000;
  // one refresh at a time, whoever asks: requests arriving during it wait for the same one (A52)
  let refreshing: Promise<void> | null = null;
  const refresh = async (pets: ReturnType<typeof indexer.pets>) => {
    if (nameOf) {
      const stale = pets.filter((p) => (names.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL).slice(0, 50);
      // eight reads at a time
      for (let i = 0; i < stale.length; i += 8)
        await Promise.all(stale.slice(i, i + 8).map(async (p) => names.set(p.id, { name: await nameOf(p.id).catch(() => names.get(p.id)?.name ?? ""), at: Date.now() })));
    }
    if (coloursOf) {
      const stale = pets.filter((p) => (colours.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL).slice(0, 200).map((p) => p.id);
      if (stale.length) {
        const got = await coloursOf(stale).catch(() => null);
        if (got) for (const id of stale) colours.set(id, { colour: got[id] ?? 0, at: Date.now() });
      }
    }
  };
  // the built tree, kept until the indexer moves on or a name or colour changes (A147)
  let built: { key: string; tree: ReturnType<typeof buildTree>; text: string } | null = null;
  const look = (pets: ReturnType<typeof indexer.pets>) => pets.map((p) => `${names.get(p.id)?.name ?? ""}:${colours.get(p.id)?.colour ?? 0}`).join("|");
  app.get("/api/tree", async (c) => {
    const pets = indexer.pets();
    refreshing ??= refresh(pets).finally(() => (refreshing = null));
    await refreshing;
    const key = `${indexer.head()}:${pets.length}:${look(pets)}`;
    if (built?.key !== key) {
      const tree = buildTree(
        pets.map((p) => {
          const name = names.get(p.id)?.name;
          const colour = colours.get(p.id)?.colour;
          return { ...p, ...(name ? { name } : {}), ...(colour ? { colour } : {}) };
        }),
      );
      built = { key, tree, text: JSON.stringify({ ok: true, indexedTo: indexer.head(), ...tree }) };
    }
    c.header("Cache-Control", "public, max-age=30");
    // a page of pets after a given one, for whoever wants the tree in parts (A147); the whole tree otherwise
    const after = c.req.query("after");
    const limit = Number(c.req.query("limit") ?? "");
    if (after !== undefined || c.req.query("limit") !== undefined) {
      const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, TREE_PAGE_MAX) : TREE_PAGE_MAX;
      const from = after === undefined ? 0 : built.tree.pets.findIndex((p) => p.id === after) + 1;
      const page = built.tree.pets.slice(Math.max(0, from), Math.max(0, from) + n);
      const more = Math.max(0, from) + n < built.tree.pets.length;
      const { pets: _all, ...counts } = built.tree;
      return c.json({ ok: true, indexedTo: indexer.head(), ...counts, pets: page, ...(more && page.length ? { next: page[page.length - 1]!.id } : {}) });
    }
    c.header("content-type", "application/json; charset=utf-8");
    return c.body(built.text);
  });
  return app;
}

/**
 * Public diaries: owners publish the log their pet's checkpoint committed to; it is kept only if it
 * hashes to the log hash on chain, and anyone may read it (read-only, any origin).
 */
export function withDiaries(app: Hono, store: DiaryStore, chainOf: (id: string) => Promise<PetOnChain | null>, hash: LogHasher = createLogHasher()): Hono {
  const limiter = new RateLimiter(20, 60 * 60_000);
  app.get("/api/pets/:id/log", (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,12}$/.test(id)) return c.json({ ok: false, reason: "invalid" }, 400);
    const at = store.where(id);
    c.header("Cache-Control", "public, max-age=30");
    if (!at) return c.json({ ok: false, reason: "none" });
    c.header("content-type", "application/json; charset=utf-8");
    const head = '{"ok":true,"log":';
    if ("text" in at) return c.body(`${head}${at.text}}`);
    // streamed from its file a piece at a time, as fast as the reader takes it: no diary is ever held whole (A39)
    const pieces = createReadStream(at.file)[Symbol.asyncIterator]();
    const bytes = new TextEncoder();
    let stage: "head" | "file" | "tail" = "head";
    return c.body(
      new ReadableStream<Uint8Array>({
        async pull(out) {
          if (stage === "head") {
            out.enqueue(bytes.encode(head));
            stage = "file";
            return;
          }
          if (stage === "file") {
            const next = await pieces.next();
            if (!next.done) return out.enqueue(next.value as Uint8Array);
            stage = "tail";
          }
          out.enqueue(bytes.encode("}"));
          out.close();
        },
        async cancel() {
          await pieces.return?.();
        },
      }),
    );
  });
  app.post("/api/pets/:id/log", async (c) => {
    const ip = clientIp(c);
    // a refusal a player can meet is an answer, not an error a browser would log (A39); only a malformed request is a 400
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy" });
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    // parsed once here; the store checks every cheap bound before the hash, which runs in a worker (A114)
    const published = PublishedLog.safeParse(body);
    if (!published.success || published.data.petId !== id) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = await store.publishLog(published.data, await chainOf(id).catch(() => null), ip, hash);
    return c.json(r, !r.ok && r.reason === "invalid" ? 400 : 200);
  });
  return app;
}

/** Moving pets between Telegram and a browser: a one-time code, claimed once within minutes. */
export function withMove(app: Hono, store: MoveStore, limiter = new RateLimiter(20, 60 * 60_000)): Hono {
  const ipOf = (c: Context) => clientIp(c);
  app.post("/api/move", async (c) => {
    if (!limiter.take(ipOf(c))) return c.json({ ok: false, reason: "busy" }, 429);
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
    let body;
    try {
      body = PushPlanBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = pusher.plan(body, Date.now(), ip);
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

/**
 * Sizes of the server's data files and folders, in KB, so a store growing without bound shows before it hurts. Walked
 * without blocking the request thread (a folder can hold tens of thousands of files), and kept five minutes (A64).
 */
const STORE_SIZES_MS = 5 * 60_000;
let sizesKept: { at: number; value: Promise<Record<string, number>> } | null = null;
function storeSizes(dir: string): Promise<Record<string, number>> {
  if (sizesKept && Date.now() - sizesKept.at < STORE_SIZES_MS) return sizesKept.value;
  const sizeOf = async (p: string): Promise<number> => {
    const st = await stat(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const f of await readdir(p)) n += await sizeOf(join(p, f));
    return n;
  };
  const value = (async () => {
    const out: Record<string, number> = {};
    try {
      for (const f of await readdir(dir)) out[f] = Math.round((await sizeOf(join(dir, f))) / 1024);
    } catch {
      // no data folder yet, or a file gone while it was read
    }
    return out;
  })();
  sizesKept = { at: Date.now(), value };
  return value;
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
  // each address may spend a twentieth of the day (A53), so no one address can leave everyone's teaching resting
  const modelPerDay = Number(process.env.LINGXI_MODEL_TOKENS_PER_DAY ?? 2_000_000);
  const modelBudget = createTokenBudget({ perDay: modelPerDay, perAddress: Number(process.env.LINGXI_MODEL_TOKENS_PER_ADDRESS ?? modelPerDay / 20), file: resolve(dirname(fileURLToPath(import.meta.url)), "../data/model-budget.json") });
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
  // A52: what the server reads on a visitor's behalf (adoption papers, the tree's names and colours, the numbers, a
  // room's name colours, the agent API) goes to X Layer's official host the jobs do not read from, falling back to the
  // jobs' node only when that fails, so visitors can never get the jobs' node to throttle us; on any other node (a
  // fork) both are that node
  const officialHosts = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
  const visitorUrls = officialHosts.includes(rpcMain) ? [...officialHosts.filter((u) => u !== rpcMain), rpcMain] : [rpcMain];
  // the jobs' node, when it is the fallback, is on a budget (A81): a busy minute of visitors never lands on it whole
  const jobsNode = createPublicClient({ transport: http(rpcMain, { timeout: 10_000 }) });
  const visitorTransports = visitorUrls.map((u) =>
    officialHosts.includes(rpcMain) && u === rpcMain ? custom({ request: budgetedRequest((args) => jobsNode.request(args as never)) }) : http(u, { timeout: 10_000 }),
  );
  const visitorPub = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: visitorUrls } } }, transport: fallback(visitorTransports) }) as PublicClient;
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
  // made after the record is read: it tapes out on the deployment's processor. A relayer that cannot start (its store
  // unreadable) takes only relaying down, never the whole server (A139)
  let relayer: BrainRelayer | null = null;
  try {
    relayer = makeRelayer();
  } catch (e) {
    process.stderr.write(`relaying is off: ${(e as Error).message}\n`);
  }
  // homes (plan 4.9): what visitors see is what the home's linked wallets hold on X Layer
  const homeChain: HomeChain | undefined = chainCtx && {
    roomPacks: async (wallets) => (await packsHeld(visitorPub, chainCtx!.deployment, wallets)).room,
    piecesHeld: (wallets) => piecesHeld(visitorPub, chainCtx!.deployment, wallets),
    ownerOf: async (id) => (await visitorPub.readContract({ address: chainCtx!.deployment.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [id] })) as `0x${string}`,
    nameColour: async (id) => (await nameColours(visitorPub, chainCtx!.deployment, [id]))[id.toString()] ?? 0,
  };
  const live = new LiveRooms(createDecorStore(process.env.LINGXI_DECOR_STORE), createHomes({ ...(homeChain ? { chain: homeChain } : {}), file: process.env.LINGXI_HOMES_STORE }));
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // what /api/health reports beyond its switches; chain reads are cached so a busy health check costs nothing
  const watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number } = {};
  let cached: { at: number; value: Record<string, unknown> } | null = null;
  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../data");
  const detail: HealthDetail = async () => {
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const [head, relayerWei, fees] = await Promise.all([watch.head?.().catch(() => null) ?? null, relayer?.balance().catch(() => null) ?? null, relayer?.fees().catch(() => null) ?? null]);
    // how many more tape-outs the relayer's BEM pays the transistor fee for (two kinds minted each, at most) (A40)
    const bemTapeouts = fees && fees.feeIn === "bem" && fees.protocolFee > 0n ? Number(fees.bem / (fees.protocolFee * 2n)) : null;
    const value = {
      jobs: Object.fromEntries(jobs.status().map((j) => [j.name, j.healthy ? "ok" : `failing: ${j.lastError?.message ?? "?"}`])),
      indexerLagBlocks: head !== null && watch.indexed ? Number(head) - watch.indexed() : null,
      packetsLagBlocks: head !== null && watch.packets ? Number(head) - watch.packets() : null,
      relayerOkb: relayerWei === null ? null : Number(relayerWei) / 1e18,
      // the alarm the outside check turns into an issue for Prateek: top the relayer up before players are refused
      relayerLow: relayerWei !== null && Number(relayerWei) / 1e18 < Number(process.env.LINGXI_RELAY_ALARM_OKB ?? 0.02),
      relayerBem: fees ? Number(fees.bem) / 1e8 : null,
      relayFeeIn: fees?.feeIn ?? null,
      relayerBemTapeouts: bemTapeouts,
      // the same alarm for BEM: below ten tape-outs' transistor fees, top it up before players are refused
      relayerBemLow: bemTapeouts !== null && bemTapeouts < Number(process.env.LINGXI_RELAY_ALARM_BEM_TAPEOUTS ?? 10),
      relayerUsage: relayer?.usage() ?? null,
      modelTokensToday: client ? { used: modelBudget.used(), perDay: modelBudget.perDay, perAddress: modelBudget.perAddress, ...modelBudget.measured() } : null,
      backup: backupStatus(),
      watchdog: watchdogStatus(),
      // the process's own memory, in MB: a store or cache growing without end shows here first
      memoryMb: Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1e5) / 10])),
      storesKb: await storeSizes(dataDir),
    };
    cached = { at: Date.now(), value };
    return value;
  };
  // who may keep a pet, read from PetRegistry on X Layer at the moment of the request
  const isKeeper: KeeperCheck | undefined = chainCtx
    ? async (petId, who) => (await chainCtx!.pub.readContract({ address: chainCtx!.deployment.registry, abi: petRegistryAbi, functionName: "isKeeper", args: [BigInt(petId), who] })) as boolean
    : undefined;
  // A40: sponsored tape-outs go first to pets with standing on chain. A settled pet stays settled (its days and age
  // only grow), so it is remembered for good; an unsettled one is asked again after ten minutes
  const settledPets = new Set<string>();
  const unsettledAt = new Map<string, number>();
  const isSettled: SettledCheck | undefined = chainCtx
    ? async (petId) => {
        if (settledPets.has(petId)) return true;
        const asked = unsettledAt.get(petId);
        if (asked !== undefined && Date.now() - asked < 10 * 60_000) return false;
        const yes = (await chainCtx!.pub.readContract({ address: chainCtx!.deployment.registry, abi: petRegistryAbi, functionName: "isSettled", args: [BigInt(petId)] })) as boolean;
        if (unsettledAt.size > 100_000) unsettledAt.clear();
        if (yes) {
          settledPets.add(petId);
          unsettledAt.delete(petId);
        } else unsettledAt.set(petId, Date.now());
        return yes;
      }
    : undefined;
  const quota = new RelayQuota(
    {
      perPetPerDay: 6,
      perSignerPerDay: 12,
      perHour: Number(process.env.LINGXI_RELAY_PER_HOUR ?? 12),
      perDay: Number(process.env.LINGXI_RELAY_PER_DAY ?? 200),
      newcomerShare: Number(process.env.LINGXI_RELAY_NEWCOMER_SHARE ?? 0.25),
      lifetime: { newcomer: 3, settled: 40 },
      // settled pets draw two an hour per signer, and a quarter of each hour waits for pets not served today (A142)
      settledPerSignerPerHour: 2,
      keptForUnserved: 0.25,
    },
    process.env.LINGXI_RELAY_QUOTA_FILE ?? join(dataDir, "relay-quota.json"),
  );
  // a pet's brain and parents as PetRegistry has them, read when a child relay asks (A75)
  const petOnChain: PetOnChainReader | undefined = chainCtx
    ? async (petId) => {
        try {
          const p = await readPet(chainCtx!.pub, chainCtx!.deployment, BigInt(petId));
          if (!p.born) return null;
          return { brainId: p.brainId.toString(), parents: p.parentA && p.parentB ? [p.parentA.toString(), p.parentB.toString()] : null };
        } catch (e) {
          if (/Nonexistent|NotFound|nonexistent/i.test((e as Error).message)) return null;
          throw e;
        }
      }
    : undefined;
  const app = createApp(client, undefined, relayer, undefined, live, detail, isKeeper, quota, isSettled, petOnChain);
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
  {
    // a pet kept on X Layer for a player with no wallet (H4): it spends the relayer's OKB, so it is off unless the
    // server is started with LINGXI_SPONSOR=on; a store that cannot be read turns it off rather than forget who had one
    let sponsoring: Sponsoring | null = null;
    try {
      const gate = new SponsorGate({
        file: process.env.LINGXI_SPONSOR_STORE ?? join(dataDir, "sponsored.json"),
        enabled: process.env.LINGXI_SPONSOR === "on" && relayer !== null && chainCtx !== undefined,
        perDay: Number(process.env.LINGXI_SPONSOR_PER_DAY ?? 25),
        // the day's OKB budget for keeping pets (B9), in OKB; 25 pets at the most each may cost unless told
        okbPerDayWei: parseEther(process.env.LINGXI_SPONSOR_OKB_PER_DAY ?? "0.002"),
      });
      if (relayer && chainCtx) sponsoring = { gate, relayer, deployment: chainCtx.deployment, who: clientIp };
    } catch (e) {
      process.stderr.write(`keeping pets without a wallet is off: ${(e as Error).message}\n`);
    }
    withSponsor(app, sponsoring);
  }
  // standings fought in a worker thread with a time budget, kept on disk (A38)
  const seasons = createSeasonStore(process.env.LINGXI_SEASON_STORE, Date.now, createStandingsRunner({ file: process.env.LINGXI_STANDINGS_FILE ?? join(dataDir, "standings.json") }));
  // proving an entry is a pet on X Layer: its keeper's signature, and its card thinks as its brain on chain does
  const seasonNonces = createNonceBook();
  const mindChecker = createMindChecker();
  // netlists a season proof has read; a taped-out netlist never changes (A115)
  const seasonNetlists = createNetlistCache();
  const prove: SeasonProver | undefined =
    chainCtx && isKeeper
      ? (pet, proof) =>
          proveSeasonEntry(pet, proof, {
            isKeeper,
            now: Date.now,
            nonces: seasonNonces,
            // a proven entry's brain is read through the visitors' client, at most MAX_CIRCUIT_READS circuits, each
            // netlist read once for the whole server (A115)
            brainOf: async (id) => {
              const onChain = await readPet(visitorPub, chainCtx!.deployment, BigInt(id));
              const circuit = await loadCircuitFromChain(visitorPub, onChain.processor, onChain.brainId, undefined, { cache: seasonNetlists });
              return { fast: circuitBrain(circuit), nState: circuit.nState };
            },
            // the comparison itself runs off the request thread, with a budget (A62)
            circuitOf: async (id) => {
              const onChain = await readPet(visitorPub, chainCtx!.deployment, BigInt(id));
              return loadCircuitFromChain(visitorPub, onChain.processor, onChain.brainId, undefined, { cache: seasonNetlists });
            },
            check: mindChecker,
          })
      : undefined;
  withSeason(app, seasons, undefined, undefined, prove);
  {
    // the open agent API reads pets from the deployment the game runs on
    const rpc = rpcMain;
    const chain = chainCtx;
    withAgentApi(app, { agents: createAgentStore(process.env.LINGXI_AGENT_STORE), seasons, ...(chain ? { chain: { ...chain, pub: visitorPub } } : {}) });
    // the MCP server (TAP-15): reading a pet, running a spar, proposing a lesson
    const toolDeps = chain ? { chain: { ...chain, pub: visitorPub } } : {};
    withMcp(app, toolDeps);
    // the same operations as TAP-13 methods, every answer signed by the key the published manifest names (H7)
    const tapKey = readEnvFile(process.env.LINGXI_TAP_KEY_FILE).TAP_SIGNER_PRIVATE_KEY;
    if (tapKey) {
      try {
        const file = process.env.LINGXI_TAP_MANIFEST ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/.well-known/tapeapi.json");
        const manifest = JSON.parse(readFileSync(file, "utf8")) as { container: `0x${string}`; signer: string; delegation: { expires: number }; methods: Array<{ name: string }>; mcp?: { toolsSha256: string } };
        const signer = privateKeyToAccount(tapKey as `0x${string}`);
        if (signer.address !== manifest.signer) throw new Error("the signing key is not the manifest's signer");
        if (manifest.delegation.expires <= Date.now() / 1000) throw new Error("the manifest's delegation has expired");
        // a tool is bound when the manifest lists a method of its name (TAP-15 §4.1); calls are held to its digest
        const names = manifest.methods.map((m) => m.name).filter((n) => MCP_TOOLS.some((t) => t.name === n));
        const tools = manifest.mcp ? { sha256: manifest.mcp.toolsSha256, names, mcp: (m: object) => handleMcp(m, toolDeps) } : undefined;
        withTapApi(app, { signer, container: manifest.container, ...(tools ? { tools } : {}) });
      } catch (e) {
        process.stderr.write(`signed answers off: ${(e as Error).message}
`);
      }
    }
    // the browser's door to X Layer: same origin, so a rate-limited public RPC can never look like a blocked request
    // on mainnet the door reads from X Layer's other official host than the one our jobs read from, with the jobs'
    // host as a small reserve; any other node (a local fork) serves both
    const official = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
    withRpcProxy(app, official.includes(rpc) ? { upstreams: official.filter((u) => u !== rpc), reserve: { url: rpc, perMinute: 60 } } : { upstreams: [rpc] });
    // adoption papers (plan 4.8): posted by the owner of a pet on offer, fetched by the buyer's game
    if (chain?.deployment.adoptionCentre) {
      const { deployment } = chain;
      const pub = visitorPub;
      withPapers(app, createPapersStore(process.env.LINGXI_PAPERS_STORE), {
        ownerOf: async (id) => (await pub.readContract({ address: deployment.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [id] })) as `0x${string}`,
        sellerOf: async (id) => {
          const row = (await pub.readContract({ address: deployment.adoptionCentre!, abi: adoptionCentreAbi, functionName: "listings", args: [id] })) as readonly [`0x${string}`, bigint, bigint, `0x${string}`];
          return /^0x0{40}$/i.test(row[0]) ? null : row[0];
        },
      });
    }
    withMove(app, createMoveStore());
    // short duel links: a duel code kept under the start of its own hash (A32)
    withDuels(app, createDuelStore(process.env.LINGXI_DUELS_DIR ?? join(dataDir, "duels")));
    // A34: the daily challenge's block, the first X Layer mainnet block of each UTC day, found once from mainnet's
    // official nodes (whatever chain the game runs on: the challenge is seeded by mainnet) and served same-origin
    const dailyNodes = createPublicClient({ chain: xLayer, transport: fallback(official.map((u) => http(u, { timeout: 8_000 }))) });
    const daily = createDailyBlocks(
      {
        head: async () => {
          const b = await dailyNodes.getBlock();
          return { number: Number(b.number), timestamp: Number(b.timestamp) };
        },
        block: async (n) => {
          const b = await dailyNodes.getBlock({ blockNumber: BigInt(n) });
          return { number: n, timestamp: Number(b.timestamp), hash: b.hash };
        },
      },
      { file: process.env.LINGXI_DAILY_FILE ?? join(dataDir, "daily.json") },
    );
    withDaily(app, daily);
    // today's is found soon after midnight UTC, before the first player asks; nodes that cannot answer mark the job
    jobs.every(
      "daily block",
      5 * 60_000,
      async () => {
        const today = await daily.get(dayIndex(Date.now()));
        if (!today.ok && today.reason === "unavailable") throw new Error("X Layer's official nodes did not answer");
      },
      { now: true },
    );
    // R2: Little Mars counts today's tape-outs across every X Layer processor
    const lane = createTapeoutCounter(factoryReader(rpc), process.env.LINGXI_LANE_FILE);
    withLane(app, lane);
    jobs.every("lane count", 5 * 60_000, () => lane.tick(), { now: true });
    if (chain)
      withDiaries(app, createDiaryStore(process.env.LINGXI_DIARY_DIR), async (id) => {
        // the pet's age on the chain's own clock: its hatch block's time against the latest block's (A39), read through
        // the visitors' client, so a flood of posts never lands on the jobs' node whole (A114)
        const [p, head] = await Promise.all([readPet(visitorPub, chain!.deployment, BigInt(id)), visitorPub.getBlock()]);
        return { logHash: p.logHash, born: p.born, at: Number(head.timestamp) };
      });
  }
  if (relayer) {
    // a finished week's best-placed proven pet gets its brain taped out and sent to its owner's wallet (PRD F26)
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
    withTree(
      app,
      indexer,
      look ? async (id) => String(await visitorPub.readContract({ address: look, abi: lookAbi, functionName: "nameOf", args: [BigInt(id)] })) : undefined,
      chainCtx?.deployment.extras ? (ids) => nameColours(visitorPub, chainCtx!.deployment, ids.map((x) => BigInt(x))) : undefined,
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
    // Sourcify's verdict on the deployment's contracts, asked here so an outage reaches the page as words (A71)
    if (chainCtx) {
      const own = Object.values(chainCtx.deployment).filter((v): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v));
      withSourcify(app, createSourcifyRelay({ allowed: own, base: process.env.LINGXI_SOURCIFY_URL }));
    }
    // every breeding consent standing on X Layer (A63): the breeders keep them where no page can list them
    {
      const d = chainCtx?.deployment;
      const breeders = [d?.breeder, d?.breederFree].filter((a): a is `0x${string}` => !!a);
      const from = Number(process.env.LINGXI_CONSENTS_FROM ?? d?.registryBlock ?? 0);
      if (breeders.length && from > 0) {
        const consents = createConsentIndex({ rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", breeders, fromBlock: from, store: process.env.LINGXI_CONSENTS_STORE ?? join(dataDir, "consents.json") });
        withConsents(app, consents);
        jobs.loop("consents", () => consents.catchUp(), 20_000);
      }
    }
    // live numbers: the pet counts above, both markets' sales, and the contracts' own totals
    const rpc = process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech";
    const env = (k: string) => (process.env[k] ? (process.env[k] as `0x${string}`) : undefined);
    const markets = [
      // the first market pays 3% of each sale to its treasury: deployed with the project wallet as treasury at 300 bps
      // (deploy-outfits.ts); a FeeChanged event on the walk moves either (H8)
      {
        address: env("LINGXI_MARKET_OKB"),
        fromBlock: Number(process.env.LINGXI_MARKET_OKB_FROM ?? 0),
        ...(chainCtx?.deployment.deployer ? { earns: { project: chainCtx.deployment.deployer, feeBps: 300, treasury: chainCtx.deployment.deployer } } : {}),
      },
      { address: env("LINGXI_MARKET_BEM"), fromBlock: Number(process.env.LINGXI_MARKET_BEM_FROM ?? 0) },
    ].filter((m): m is { address: `0x${string}`; fromBlock: number; earns?: EarningTerms } => !!m.address && m.fromBlock > 0);
    const sales = createSalesCounter({ rpc, markets, store: process.env.LINGXI_SALES_STORE });
    jobs.loop("sales", () => sales.catchUp(), 20_000);
    // the OKB market's listings a sale retired, which V1 itself would still sell (A23); the game shows none without it
    const okb = markets.find((m) => m.address === env("LINGXI_MARKET_OKB"));
    if (okb) {
      const listingWatch = createListingWatch({ rpc, market: okb.address, fromBlock: okb.fromBlock, store: process.env.LINGXI_MARKET_V1_STORE ?? join(dataDir, "market-v1.json") });
      withRetiredListings(app, listingWatch);
      jobs.loop("okb listings", () => listingWatch.catchUp(), 20_000);
    }
    // circuits on other processors that use Lingxi's by REF (H6): every processor TapeOut's factory made, read a little
    // each pass, progress kept
    const processor = (process.env.LINGXI_PROCESSOR ?? chainCtx?.deployment.processor) as `0x${string}` | undefined;
    const refs = processor ? createRefScanner({ rpc, factory: FACTORY, ours: processor, store: process.env.LINGXI_REFS_STORE ?? join(dataDir, "refs.json") }) : undefined;
    if (refs) jobs.loop("refs", () => refs.catchUp(), 120_000);
    // who holds each TapeCode-Test1, so a holder claims the holder pin without typing a number (H9); the collection is
    // the one the gift contract itself names
    if (chainCtx?.deployment.holderGift) {
      const giftPub = chainCtx.pub;
      const gift = chainCtx.deployment.holderGift;
      const test1 = createTest1Index({ pub: giftPub, collection: async () => (await giftPub.readContract({ address: gift, abi: holderGiftAbi, functionName: "test1" })) as `0x${string}` });
      withTest1Owners(app, test1);
      jobs.loop("test1 owners", () => test1.refresh(), TEST1_REFRESH_MS);
    }
    withNumbers(app, {
      pub: visitorPub,
      counts: (since) => indexer.counts(since),
      petsIndexedTo: () => indexer.head(),
      sales,
      ...(refs ? { refs } : {}),
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
        process.stderr.write(`vouchers off: ${(e as Error).message}\n`);
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
