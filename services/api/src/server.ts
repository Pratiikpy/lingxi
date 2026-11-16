/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { STARTERS } from "@lingxi/brain";
import { MAX_WORDS, teachInWords } from "./teach";
import { RateLimiter } from "./limit";
import { BrainRelayer } from "./relayer";
import { LiveRooms, attachLive } from "./live";
import { createDecorStore } from "./decor";
import { type SittingStore, createSittingStore } from "./sitting";
import { type ArenaStore, createArenaStore } from "./arena";
import { type SeasonStore, createSeasonStore, settleAwards } from "./season";
import { weekOf } from "@lingxi/game";
import { parseCard } from "@lingxi/game";
import { createPublicClient, http, type PublicClient } from "viem";
import { type Deployment, readPet, xLayer } from "@lingxi/chain";
import { createAgentStore } from "./agents";
import { withAgentApi } from "./agentApi";
import { type Letter, currentLetters, loadLetters } from "./mail";
import { PlanSchema, createPusher, type Pusher } from "./push";
import { VoiceRequest, createVoice } from "./voice";
import { LibraryRule, createLibrary, type Library } from "./library";
import { createIndexer, type Indexer } from "./indexer";
import { buildTree } from "./tree";
import { type DiaryStore, createDiaryStore } from "./diaries";
import { MAX_MOVE_CHARS, type MoveStore, createMoveStore } from "./move";
import { createTapeoutCounter, withLane } from "./lane";
import { factoryReader } from "./laneReader";
import { petLookAbi as lookAbi } from "@lingxi/chain";

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

const RuleSchema = z.object({
  when: z.record(z.string(), z.array(z.number().int().min(0).max(15)).max(16)),
  then: z.object({ want: z.number().int(), mood: z.number().int(), nudge: z.number().int().optional() }),
  label: z.string().max(60).optional(),
});

const TeachBody = z.object({
  words: z.string().min(1).max(MAX_WORDS),
  name: z.string().max(40).optional(),
  line: z.enum(Object.keys(STARTERS) as [keyof typeof STARTERS, ...Array<keyof typeof STARTERS>]),
  stage: z.enum(["baby", "child", "teen", "adult", "elder"]),
  lessons: z.array(RuleSchema).max(8),
});

export function createApp(client: Anthropic | null, limiter = new RateLimiter(6, 60_000), relayer: BrainRelayer | null = null, relayLimiter = new RateLimiter(4, 3_600_000), live: LiveRooms | null = null) {
  const app = new Hono();
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // the agent API is open to any origin; the game's own endpoints answer only the game's pages
  app.use("/api/*", cors({ origin: (o, c) => (c.req.path.startsWith("/api/v1") || (c.req.method === "GET" && /^\/api\/pets\/\d+\/log$/.test(c.req.path)) ? "*" : origins.includes(o) ? o : null), allowMethods: ["GET", "POST"], allowHeaders: ["Authorization", "Content-Type"], maxAge: 600 }));

  app.get("/api/health", (c) => c.json({ ok: true, teach: client !== null, voice: client !== null, relay: relayer !== null, live: live !== null }));
  app.get("/api/live/stats", (c) => c.json(live ? live.stats() : { online: 0, spaces: 0 }));

  app.post("/api/teach", async (c) => {
    if (!client) return c.json({ ok: false, reason: "error", detail: "teaching is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!limiter.take(ip)) return busy(c);
    let body: z.infer<typeof TeachBody>;
    try {
      body = TeachBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const result = await teachInWords(client, body as never);
    return result.ok || result.reason !== "busy" ? c.json(result) : busy(c);
  });

  const RelayBody = z.object({ line: TeachBody.shape.line, lessons: z.array(RuleSchema).max(8), instincts: z.number().int().min(0).max(15).optional() });
  app.post("/api/tapeout", async (c) => {
    if (!relayer) return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!relayLimiter.take(ip)) return busy(c);
    let body: z.infer<typeof RelayBody>;
    try {
      body = RelayBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const r = await relayer.relay(body.line, body.lessons as never, body.instincts ?? 0);
    return c.json(r);
  });

  // a child's brain: REFs to its parents' circuits, or (once taught) to both of its halves
  const ChildBody = z.union([z.object({ parents: z.tuple([z.string().regex(/^\d{1,20}$/), z.string().regex(/^\d{1,20}$/)]) }), z.object({ card: z.string().max(10_000) })]);
  app.post("/api/tapeout-child", async (c) => {
    if (!relayer) return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!relayLimiter.take(ip)) return busy(c);
    let body: z.infer<typeof ChildBody>;
    try {
      body = ChildBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    let r;
    if ("parents" in body) r = await relayer.relayChild({ parents: body.parents });
    else {
      const card = parseCard(body.card);
      if (!card?.family) return c.json({ ok: false, reason: "invalid", detail: "not a child's card" }, 400);
      r = await relayer.relayChild({ family: card.family, lessons: card.lessons });
    }
    return c.json(r);
  });

  // X1: an owned circuit as an everyday instinct, REF'd beside the pet's own brain
  const InstinctBody = z.object({ own: z.string().regex(/^\d{1,20}$/), processor: z.string().regex(/^0x[0-9a-fA-F]{40}$/), id: z.string().regex(/^\d{1,20}$/) });
  app.post("/api/tapeout-instinct", async (c) => {
    if (!relayer) return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!relayLimiter.take(ip)) return busy(c);
    let body: z.infer<typeof InstinctBody>;
    try {
      body = InstinctBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    return c.json(await relayer.relayInstinct({ own: body.own, processor: body.processor as `0x${string}`, id: body.id }));
  });

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
  });
}

/**
 * Serves the built site from the same origin as the API, with safe headers: the
 * landing page at /, the game at /play.html, the proof page at /verify.html.
 */
export function withSite(app: Hono, root: string): Hono {
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // the game runs inside Telegram Web's frame as a Mini App; every other page stays unframeable by others
    if (c.req.path === "/play.html") c.header("Content-Security-Policy", "frame-ancestors 'self' https://web.telegram.org https://*.web.telegram.org");
    else c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  });
  app.use("/assets/*", async (c, next) => {
    await next();
    // hashed file names: safe to cache for a year
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/*", serveStatic({ root, rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p) }));
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
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    // a missing line is normal (the pet falls back to its own words), so busy and
    // model hiccups answer 200 with ok:false rather than showing up as page errors
    if (!limiter.take(ip)) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, reason: "busy" });
    }
    if (Number(c.req.header("content-length") ?? 0) > 2048) return c.json({ ok: false, reason: "invalid" }, 413);
    let body;
    try {
      body = VoiceRequest.parse(await c.req.json());
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
  const who = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  app.post("/api/sit", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 700_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = z.object({ pack: z.string(), keyHash: z.string(), until: z.number() }).parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(store.leave(body.pack, body.keyHash, body.until));
  });
  app.get("/api/sit/:code", (c) => {
    const r = store.collect(c.req.param("code"));
    return c.json(r ? { ok: true, ...r } : { ok: false, reason: "unknown" });
  });
  app.post("/api/sit/:code/home", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 700_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = z.object({ key: z.string(), pet: z.string() }).parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(store.sendHome(c.req.param("code"), body.key, body.pet) ? { ok: true } : { ok: false, reason: "refused" });
  });
  return app;
}

/** Arena snapshots: save the line fielded at a round; meet another player's line at the same round. */
export function withArena(app: Hono, store: ArenaStore, writes = new RateLimiter(120, 3_600_000)): Hono {
  const who = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  app.post("/api/arena/snapshot", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 16_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = z.object({ round: z.number().int(), pet: z.unknown(), team: z.unknown(), device: z.string() }).parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = store.save(body.round, body.pet, body.team, body.device);
    return c.json(r, r.ok ? 200 : 400);
  });
  app.get("/api/arena/opponent", (c) => {
    const round = Number(c.req.query("round"));
    const device = c.req.query("device") ?? "";
    if (!Number.isInteger(round) || round < 0 || device.length < 8 || device.length > 64) return c.json({ ok: false, reason: "invalid" }, 400);
    const s = store.pick(round, device);
    return c.json(s ? { ok: true, ...s } : { ok: false, reason: "none" });
  });
  return app;
}

/** Weekly seasons: enter this week with one tap; read any week's entries and standings. */
export function withSeason(app: Hono, store: SeasonStore, writes = new RateLimiter(30, 3_600_000), now: () => number = Date.now): Hono {
  const who = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  app.post("/api/season/enter", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 16_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body;
    try {
      body = z.object({ pet: z.unknown(), device: z.string(), wallet: z.string().optional() }).parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = store.enter(body.pet, body.device, body.wallet);
    // a full week is normal play: answer 200 so the page shows our own message
    return c.json(r, r.ok || r.reason === "full" ? 200 : 400);
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
  const who = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  const Key = z.object({ key: z.string().regex(/^[0-9a-f]{24}$/) });
  app.get("/api/lessons", (c) => {
    c.header("Cache-Control", "public, max-age=30");
    return c.json({ ok: true, lessons: library.list(40) });
  });
  app.post("/api/lessons/share", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = z.object({ rule: LibraryRule, by: z.string().max(40) }).parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = library.share(body.rule as never, body.by, who(c), Date.now());
    return c.json(r, r.ok ? 200 : 400);
  });
  for (const action of ["use", "report"] as const) {
    app.post(`/api/lessons/${action}`, async (c) => {
      if (!writes.take(who(c))) return busy(c);
      let body;
      try {
        body = Key.parse(await c.req.json());
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

/**
 * The tree of life: every pet on chain with its generation, ancestors and the
 * owners who raised them. Names come from PetLook and are remembered for ten minutes.
 */
export function withTree(app: Hono, indexer: Pick<Indexer, "pets" | "head">, nameOf?: (id: string) => Promise<string>): Hono {
  const names = new Map<string, { name: string; at: number }>();
  const NAME_TTL = 10 * 60_000;
  app.get("/api/tree", async (c) => {
    const pets = indexer.pets();
    if (nameOf) {
      const stale = pets.filter((p) => (names.get(p.id)?.at ?? 0) < Date.now() - NAME_TTL).slice(0, 50);
      await Promise.all(stale.map(async (p) => names.set(p.id, { name: await nameOf(p.id).catch(() => names.get(p.id)?.name ?? ""), at: Date.now() })));
    }
    const tree = buildTree(pets.map((p) => ({ ...p, ...(names.get(p.id)?.name ? { name: names.get(p.id)!.name } : {}) })));
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
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy" }, 429);
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    if ((body as { petId?: unknown })?.petId !== id) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = store.publish(body, await logHashOf(id).catch(() => null));
    return c.json(r, r.ok ? 200 : r.reason === "invalid" ? 400 : 409);
  });
  return app;
}

/** Moving pets between Telegram and a browser: a one-time code, claimed once within minutes. */
export function withMove(app: Hono, store: MoveStore, limiter = new RateLimiter(20, 60 * 60_000)): Hono {
  const ipOf = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  app.post("/api/move", async (c) => {
    if (!limiter.take(ipOf(c))) return c.json({ ok: false, reason: "busy" }, 429);
    if (Number(c.req.header("content-length") ?? 0) > MAX_MOVE_CHARS * 2) return c.json({ ok: false, reason: "tooBig" }, 413);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = store.put((body as { save?: unknown })?.save);
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
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!limiter.take(ip)) return busy(c);
    if (Number(c.req.header("content-length") ?? 0) > 4096) return c.json({ ok: false, reason: "invalid" }, 413);
    let body;
    try {
      body = PlanSchema.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = pusher.plan(body, Date.now());
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/push/stop", async (c) => {
    let endpoint: string;
    try {
      endpoint = z.object({ endpoint: z.string().max(800) }).parse(await c.req.json()).endpoint;
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const key = loadKey();
  const client = key ? new Anthropic({ apiKey: key }) : null;
  const port = Number(process.env.PORT ?? 8787);
  const relayer = makeRelayer();
  const live = new LiveRooms(createDecorStore(process.env.LINGXI_DECOR_STORE));
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  const app = createApp(client, undefined, relayer, undefined, live);
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
  withSeason(app, seasons);
  {
    // the open agent API reads pets from the deployment the game runs on
    const rpc = process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech";
    let chain: { pub: PublicClient; deployment: Deployment } | undefined;
    try {
      const file = process.env.LINGXI_DEPLOYMENT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/chain/deployments/xlayer.json");
      const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
      chain = { pub: createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) }) as PublicClient, deployment };
    } catch (e) {
      process.stderr.write(`agent API without chain reads: ${(e as Error).message}\n`);
    }
    withAgentApi(app, { agents: createAgentStore(process.env.LINGXI_AGENT_STORE), seasons, ...(chain ? { chain } : {}) });
    withMove(app, createMoveStore());
    // R2: Little Mars counts today's tape-outs across every X Layer processor
    const lane = createTapeoutCounter(factoryReader(rpc), process.env.LINGXI_LANE_FILE);
    withLane(app, lane);
    const laneTick = () => void lane.tick().catch((e: Error) => process.stderr.write(`lane count: ${e.message}
`));
    laneTick();
    setInterval(laneTick, 5 * 60_000);
    if (chain) withDiaries(app, createDiaryStore(process.env.LINGXI_DIARY_DIR), async (id) => (await readPet(chain!.pub, chain!.deployment, BigInt(id))).logHash);
  }
  if (relayer) {
    // a finished week's champion gets its brain taped out and sent to its wallet (PRD F26)
    let giving = false;
    const giveKeepsakes = () => {
      if (giving) return;
      giving = true;
      void settleAwards(seasons, async (entry, wallet) => {
        const card = parseCard(entry.pet.card);
        if (!card) return { ok: false, detail: "damaged card" };
        const r = await relayer.keepsake({ line: entry.pet.line, lessons: card.lessons, instincts: card.instincts, family: card.family }, wallet as `0x${string}`);
        if (!r.ok) process.stderr.write(`season keepsake failed: ${r.reason} ${r.detail ?? ""}\n`);
        return r.ok ? { ok: true, brainId: r.brainId, tapeTx: r.tapeTx, sendTx: r.sendTx } : { ok: false, detail: r.detail };
      })
        .catch((e) => process.stderr.write(`season keepsakes: ${(e as Error).message}\n`))
        .finally(() => (giving = false));
    };
    setTimeout(giveKeepsakes, 30_000);
    setInterval(giveKeepsakes, 10 * 60_000);
  }
  if (process.env.LINGXI_REGISTRY && process.env.LINGXI_REGISTRY_FROM) {
    const indexer = createIndexer({ rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", registry: process.env.LINGXI_REGISTRY as `0x${string}`, fromBlock: Number(process.env.LINGXI_REGISTRY_FROM), store: process.env.LINGXI_HISTORY_STORE });
    withHistory(app, indexer);
    const look = process.env.LINGXI_LOOK as `0x${string}` | undefined;
    const lookClient = createPublicClient({ transport: http(process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", { timeout: 10_000 }) });
    withTree(app, indexer, look ? async (id) => String(await lookClient.readContract({ address: look, abi: lookAbi, functionName: "nameOf", args: [BigInt(id)] })) : undefined);
    const loop = () => indexer.catchUp().catch(() => 0).finally(() => setTimeout(loop, 15_000));
    loop();
  }
  const pusher = makePusher();
  if (pusher) {
    withPush(app, pusher);
    setInterval(() => void pusher.tick(Date.now()), 60_000);
  }
  if (process.env.LINGXI_STATIC) withSite(app, process.env.LINGXI_STATIC);
  const server = serve({ fetch: app.fetch, port });
  attachLive(server as never, live, origins);
  process.stdout.write(`lingxi api on :${port} (teaching ${client ? "on" : "off: no key"}, relaying ${relayer ? "on" : "off"}, reminders ${pusher ? "on" : "off"})\n`);
}
