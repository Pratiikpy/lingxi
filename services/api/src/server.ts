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
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { STARTERS } from "@lingxi/brain";
import { MAX_WORDS, teachInWords } from "./teach";
import { RateLimiter } from "./limit";
import { BrainRelayer } from "./relayer";
import { LiveRooms, attachLive } from "./live";
import { parseCard } from "@lingxi/game";

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
  app.use("/api/*", cors({ origin: origins, allowMethods: ["GET", "POST"], maxAge: 600 }));

  app.get("/api/health", (c) => c.json({ ok: true, teach: client !== null, relay: relayer !== null, live: live !== null }));
  app.get("/api/live/stats", (c) => c.json(live ? live.stats() : { online: 0, spaces: 0 }));

  app.post("/api/teach", async (c) => {
    if (!client) return c.json({ ok: false, reason: "error", detail: "teaching is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!limiter.take(ip)) return c.json({ ok: false, reason: "busy" }, 429);
    let body: z.infer<typeof TeachBody>;
    try {
      body = TeachBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const result = await teachInWords(client, body as never);
    return c.json(result, result.ok ? 200 : result.reason === "busy" ? 429 : 200);
  });

  const RelayBody = z.object({ line: TeachBody.shape.line, lessons: z.array(RuleSchema).max(8) });
  app.post("/api/tapeout", async (c) => {
    if (!relayer) return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!relayLimiter.take(ip)) return c.json({ ok: false, reason: "busy" }, 429);
    let body: z.infer<typeof RelayBody>;
    try {
      body = RelayBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const r = await relayer.relay(body.line, body.lessons as never);
    return c.json(r, r.ok ? 200 : r.reason === "budget" ? 429 : 200);
  });

  // a child's brain: REFs to its parents' circuits, or (once taught) to both of its halves
  const ChildBody = z.union([z.object({ parents: z.tuple([z.string().regex(/^\d{1,20}$/), z.string().regex(/^\d{1,20}$/)]) }), z.object({ card: z.string().max(10_000) })]);
  app.post("/api/tapeout-child", async (c) => {
    if (!relayer) return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
    if (!relayLimiter.take(ip)) return c.json({ ok: false, reason: "busy" }, 429);
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
    return c.json(r, r.ok ? 200 : r.reason === "budget" ? 429 : 200);
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const key = loadKey();
  const client = key ? new Anthropic({ apiKey: key }) : null;
  const port = Number(process.env.PORT ?? 8787);
  const relayer = makeRelayer();
  const live = new LiveRooms();
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  const server = serve({ fetch: createApp(client, undefined, relayer, undefined, live).fetch, port });
  attachLive(server as never, live, origins);
  process.stdout.write(`lingxi api on :${port} (teaching ${client ? "on" : "off: no key"}, relaying ${relayer ? "on" : "off"})\n`);
}
