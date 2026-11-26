/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { withOriginCheck } from "./originCheck";
import { createErrorLog, withErrors } from "./clientErrors";
import { readEnvFile } from "./envFile";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { releaseSource } from "./releases";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  BrainRelayPayload,
  ChildRelayPayload,
  InstinctRelayPayload,
  RelayEnvelope,
  TeachBody,
} from "@lingxi/api-schema";
import { mindOf, teachInWords } from "./teach";
import { RateLimiter } from "./limit";
import { BrainRelayer, type RelayResult } from "./relayer";
import { RelayQuota, checkRelayAuth, createNonceBook } from "./relayGate";
import { LiveRooms, attachLive } from "./live";
import { createDecorStore } from "./decor";
import { createSittingStore } from "./sitting";
import { createArenaStore } from "./arena";
import { parseCard } from "@lingxi/game";
import { createHomes } from "./homes";
import { loadLetters } from "./mail";
import { createVoice } from "./voice";
import { createLibrary } from "./library";
import { withReadLimits } from "./readLimits";
import { clientIp, directLocal } from "./clientIp";
import { withBodyLimits } from "./bodyLimits";
import { budgetedClient, createTokenBudget, modelCaller } from "./tokenBudget";
import { createJobs } from "./jobs";
import { withSite } from "./routes/site";
import { busy, withVoice, withSitting, withArena, withPush, makePusher, withMail, withLibrary } from "./routes/play";
import { withSeason } from "./routes/season";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "./routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "./routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "./routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "./routes/chainReads";
import { readChain, homeChainOf } from "./boot/chain";
import { healthDetail } from "./boot/health";
import { relayChecks, mountSponsor } from "./boot/relay";
import { createSeasons, startKeepsakes } from "./boot/seasons";
import { mountOpenApis } from "./boot/openApis";
import { startRegistryJobs } from "./boot/registryJobs";

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
  // and a write is taken only from the game's own pages (originCheck.ts, R13)
  withOriginCheck(app, origins);
  app.use(
    "/api/*",
    cors({
      origin: (o, c) =>
        c.req.path.startsWith("/api/v1") ||
        (c.req.method === "GET" && /^\/api\/pets\/\d+\/(log|history)$/.test(c.req.path))
          ? "*"
          : origins.includes(o)
            ? o
            : null,
      allowMethods: ["GET", "POST"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );

  // the parts are booleans (true when on), for anyone; `detail` (balances, usage, memory, stores) is everything else
  // worth watching, and goes only to a request made on this machine directly: the status check (A64)
  app.get("/api/health", async (c) =>
    c.json({
      ok: true,
      teach: client !== null,
      voice: client !== null,
      relay: relayer !== null,
      live: live !== null,
      ...(detail && directLocal(c) ? { detail: await detail() } : {}),
    }),
  );
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
    const result = await modelCaller.run(ip, () =>
      teachInWords(client, {
        words: body.words,
        ...(body.name !== undefined ? { name: body.name } : {}),
        stage: body.stage,
        mind,
      }),
    );
    return result.ok || result.reason !== "busy" ? c.json(result) : busy(c);
  });

  // every relay request is the signed form (see relayGate.ts and @lingxi/chain's relayAuth.ts); its payload is the
  // route's own schema
  const nonces = createNonceBook();
  const refusalStatus: Record<string, 401 | 403 | 429 | 503> = {
    unsigned: 401,
    expired: 401,
    badSignature: 401,
    replayed: 401,
    notKeeper: 403,
    chainUnread: 503,
    busy: 429,
  };

  /** The shared path of the three relay routes: who asked, how often, and what they asked for. */
  const relayRoute = <T>(
    path: string,
    kind: "brain" | "child" | "instinct",
    schema: z.ZodType<T>,
    /** `relayer` is the one this route checked is there before calling it */
    act: (body: T, petId: string, relayer: BrainRelayer) => Promise<RelayResult>,
    most: (body: T) => number = () => 1,
  ) =>
    app.post(path, async (c) => {
      if (!relayer || !isKeeper)
        return c.json({ ok: false, reason: "error", detail: "relaying is not configured" }, 503);
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
      const slot = quota.take(
        req.petId,
        gate.signer,
        // an unread standing counts the pet as a newcomer, the smaller share: never more than it is owed
        await isSettled(req.petId).catch(() => false),
        Date.now(),
        most(body),
      );
      if (!slot.ok) return slot.reason === "busy" ? busy(c) : c.json({ ok: false, reason: slot.reason });
      let result: RelayResult;
      try {
        result = await act(body, req.petId, relayer);
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

  relayRoute("/api/tapeout", "brain", BrainRelayPayload, (b, _petId, r) =>
    r.relay(b.line, b.lessons, b.instincts ?? 0, b.skills ?? []),
  );
  relayRoute(
    "/api/tapeout-child",
    "child",
    ChildRelayPayload,
    async (b, petId, r) => {
      // only for this pet as the chain has it: a birth's first parent is its own brain, a taught child's card a child's (A75)
      const pet = petOnChain ? await petOnChain(petId).catch(() => undefined) : null;
      if (pet === undefined) return { ok: false, reason: "error", detail: "X Layer could not be read" };
      if (petOnChain && pet === null) return { ok: false, reason: "invalid", detail: "no such pet" };
      if ("parents" in b) {
        if (pet && pet.brainId !== b.parents[0])
          return { ok: false, reason: "invalid", detail: "the first parent is not this pet's brain" };
        return r.relayChild({ parents: b.parents });
      }
      if (pet && !pet.parents) return { ok: false, reason: "invalid", detail: "this pet is not a child" };
      const card = parseCard(b.card);
      if (!card?.family) return { ok: false, reason: "invalid", detail: "not a child's card" };
      return r.relayChild({
        family: card.family,
        lessons: card.lessons,
        ...(card.growth ? { growth: card.growth } : {}),
      });
    },
    // a taught child's two halves and its glue; a birth's glue alone
    (b) => ("parents" in b ? 1 : 3),
  );
  relayRoute("/api/tapeout-instinct", "instinct", InstinctRelayPayload, (b, _petId, r) =>
    r.relayInstinct({ own: b.own, processor: b.processor as `0x${string}`, id: b.id }),
  );

  return app;
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

// the server starts when it is the program being run: directly (node or tsx name it as the first argument), or by pm2,
// which runs it through a wrapper of its own and names it in pm_exec_path (P3b: the built server, started by pm2, never
// listened while only the first argument was looked at). Imported by a test, it does not start.
const self = fileURLToPath(import.meta.url);
const samePath = (p: string | undefined) =>
  !!p && (process.platform === "win32" ? resolve(p).toLowerCase() === self.toLowerCase() : resolve(p) === self);
const isMain = samePath(process.argv[1]) || samePath(process.env.pm_exec_path);
if (isMain) {
  // a stray rejection is logged and the server keeps serving; an exception means state may be broken, so it exits and
  // pm2 starts it clean (every timer runs through `jobs`, which catches its own errors, so neither should happen)
  process.on("unhandledRejection", (e) =>
    process.stderr.write(`unhandled rejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`),
  );
  process.on("uncaughtException", (e) => {
    process.stderr.write(`uncaught exception: ${e.stack ?? e.message}\n`);
    process.exit(1);
  });
  const jobs = createJobs();
  const key = loadKey();
  // teaching and voices share one daily token budget, kept on disk so a restart does not reset it (tokenBudget.ts)
  // each address may spend a twentieth of the day (A53), so no one address can leave everyone's teaching resting
  const modelPerDay = Number(process.env.LINGXI_MODEL_TOKENS_PER_DAY ?? 2_000_000);
  const modelBudget = createTokenBudget({
    perDay: modelPerDay,
    perAddress: Number(process.env.LINGXI_MODEL_TOKENS_PER_ADDRESS ?? modelPerDay / 20),
    file: resolve(dirname(fileURLToPath(import.meta.url)), "../data/model-budget.json"),
  });
  const client = key ? budgetedClient(new Anthropic({ apiKey: key }), modelBudget) : null;
  const port = Number(process.env.PORT ?? 8787);
  // the deployment the game runs on, read once: the agent API, adoption papers and what visitors see all use it
  const rpcMain = process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech";
  const { chainCtx, visitorPub } = readChain({ rpcMain });
  // made after the record is read: it tapes out on the deployment's processor. A relayer that cannot start (its store
  // unreadable) takes only relaying down, never the whole server (A139)
  let relayer: BrainRelayer | null = null;
  try {
    relayer = makeRelayer();
  } catch (e) {
    process.stderr.write(`relaying is off: ${(e as Error).message}\n`);
  }
  const { homeChain } = homeChainOf({ chainCtx, visitorPub });
  const live = new LiveRooms(
    createDecorStore(process.env.LINGXI_DECOR_STORE),
    createHomes({ ...(homeChain ? { chain: homeChain } : {}), file: process.env.LINGXI_HOMES_STORE }),
  );
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // what /api/health reports beyond its switches; chain reads are cached so a busy health check costs nothing
  const watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number } = {};
  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../data");
  // P8: the game's own uncaught errors, reported by players' browsers; each also goes to this server's log
  const errors = createErrorLog({ log: (line) => process.stderr.write(line) });
  const { detail } = healthDetail({ jobs, client, modelBudget, relayer, watch, dataDir, errors });
  const { isKeeper, isSettled, quota, petOnChain } = relayChecks({ chainCtx, dataDir });
  const app = createApp(client, undefined, relayer, undefined, live, detail, isKeeper, quota, isSettled, petOnChain);
  if (client) withVoice(app, createVoice(client));
  withLibrary(app, createLibrary(process.env.LINGXI_LIBRARY_STORE));
  withErrors(app, errors);
  withSitting(app, createSittingStore(process.env.LINGXI_SIT_STORE));
  withArena(app, createArenaStore(process.env.LINGXI_ARENA_STORE));
  {
    // letters ship with the server; a redeploy brings new ones
    const file =
      process.env.LINGXI_MAIL_FILE ?? resolve(dirname(fileURLToPath(import.meta.url)), "../mail/letters.json");
    const letters = loadLetters(file);
    withMail(app, () => letters);
  }
  const { sponsorOn } = mountSponsor({ chainCtx, relayer, dataDir, app });
  const { seasons, prove } = createSeasons({ chainCtx, visitorPub, dataDir, isKeeper });
  withSeason(app, seasons, undefined, undefined, prove);
  mountOpenApis({ jobs, rpcMain, chainCtx, visitorPub, dataDir, app, seasons });
  startKeepsakes({ jobs, chainCtx, relayer, seasons });
  startRegistryJobs({ jobs, chainCtx, visitorPub, relayer, watch, dataDir, app, sponsorOn });
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
  process.stdout.write(
    `lingxi api on ${hostname}:${port} (teaching ${client ? "on" : "off: no key"}, relaying ${relayer ? "on" : "off"}, reminders ${pusher ? "on" : "off"})\n`,
  );
}
