/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { releaseSource } from "./releases";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { circuitBrain } from "@lingxi/brain";
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
import { SponsorGate } from "./sponsor";
import { RelayQuota, checkRelayAuth, createNonceBook } from "./relayGate";
import { LiveRooms, attachLive } from "./live";
import { createDecorStore } from "./decor";
import { createSittingStore } from "./sitting";
import { createArenaStore } from "./arena";
import { createSeasonStore, settleAwards } from "./season";
import { dayIndex } from "@lingxi/game";
import { parseCard } from "@lingxi/game";
import { createPublicClient, custom, fallback, getAddress, http, parseEther, type PublicClient } from "viem";
import {
  FACTORY,
  type Deployment,
  adoptionCentreAbi,
  createNetlistCache,
  holderGiftAbi,
  loadCircuitFromChain,
  nameColours,
  packsHeld,
  petRegistryAbi,
  piecesHeld,
  readPet,
  xLayer,
} from "@lingxi/chain";
import { type HomeChain, createHomes } from "./homes";
import { createAgentStore } from "./agents";
import { withAgentApi } from "./agentApi";
import { withTapApi } from "./tapApi";
import { TEST1_REFRESH_MS, createTest1Index, withTest1Owners } from "./test1Owners";
import { handleMcp, withMcp } from "./mcp";
import { MCP_TOOLS } from "./mcpToolDefs";
import { loadLetters } from "./mail";
import { createVoice } from "./voice";
import { createLibrary } from "./library";
import { createIndexer } from "./indexer";
import { createPacketIndex } from "./packets";
import { createGoalLedger, withGoals } from "./goals";
import { withVouchers } from "./voucher";
import { createPapersStore, withPapers } from "./papers";
import { createMindChecker } from "./mindCheck";
import { createConsentIndex, withConsents } from "./consents";
import { withReadLimits } from "./readLimits";
import { budgetedRequest } from "./visitorBudget";
import { createSourcifyRelay, withSourcify } from "./sourcify";
import { withRpcProxy } from "./rpc";
import { privateKeyToAccount } from "viem/accounts";
import { type EarningTerms, createSalesCounter, withNumbers } from "./numbers";
import { createCircuitCounter } from "./circuits";
import { seedStore, snapshotFits } from "./snapshot";
import { readTeamFile } from "./team";
import { createRefScanner } from "./refScan";
import { createListingWatch, withRetiredListings } from "./marketV1";
import { createDuelStore, withDuels } from "./duels";
import { createDailyBlocks, withDaily } from "./daily";
import { createStandingsRunner } from "./standings";
import { createDiaryStore } from "./diaries";
import { createMoveStore } from "./move";
import { createTapeoutCounter, withLane } from "./lane";
import { factoryReader } from "./laneReader";
import { petLookAbi as lookAbi } from "@lingxi/chain";
import { clientIp, directLocal } from "./clientIp";
import { withBodyLimits } from "./bodyLimits";
import { proveSeasonEntry } from "./seasonProof";
import { budgetedClient, createTokenBudget, modelCaller } from "./tokenBudget";
import { createJobs } from "./jobs";
import { withSite } from "./routes/site";
import {
  busy,
  withVoice,
  withSitting,
  withArena,
  withMove,
  withPush,
  makePusher,
  withMail,
  withLibrary,
} from "./routes/play";
import { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "./routes/season";
import { withHistory, withPackets, withTree, withDiaries } from "./routes/chainReads";
import { serverBuild, SNAPSHOT_DIR, backupStatus, watchdogStatus, storeSizes } from "./routes/health";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "./routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "./routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "./routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "./routes/chainReads";

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
  const refusalStatus: Record<string, 401 | 403 | 429> = {
    unsigned: 401,
    expired: 401,
    badSignature: 401,
    replayed: 401,
    notKeeper: 403,
    busy: 429,
  };

  /** The shared path of the three relay routes: who asked, how often, and what they asked for. */
  const relayRoute = <T>(
    path: string,
    kind: "brain" | "child" | "instinct",
    schema: z.ZodType<T>,
    act: (body: T, petId: string) => Promise<RelayResult>,
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
        await isSettled(req.petId).catch(() => false),
        Date.now(),
        most(body),
      );
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

  relayRoute("/api/tapeout", "brain", BrainRelayPayload, (b) =>
    relayer!.relay(b.line, b.lessons, b.instincts ?? 0, b.skills ?? []),
  );
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
        if (pet && pet.brainId !== b.parents[0])
          return { ok: false, reason: "invalid", detail: "the first parent is not this pet's brain" };
        return relayer!.relayChild({ parents: b.parents });
      }
      if (pet && !pet.parents) return { ok: false, reason: "invalid", detail: "this pet is not a child" };
      const card = parseCard(b.card);
      if (!card?.family) return { ok: false, reason: "invalid", detail: "not a child's card" };
      return relayer!.relayChild({
        family: card.family,
        lessons: card.lessons,
        ...(card.growth ? { growth: card.growth } : {}),
      });
    },
    // a taught child's two halves and its glue; a birth's glue alone
    (b) => ("parents" in b ? 1 : 3),
  );
  relayRoute("/api/tapeout-instinct", "instinct", InstinctRelayPayload, (b) =>
    relayer!.relayInstinct({ own: b.own, processor: b.processor as `0x${string}`, id: b.id }),
  );

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
  let chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  try {
    const file =
      process.env.LINGXI_DEPLOYMENT ??
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/chain/deployments/xlayer.json");
    const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
    chainCtx = {
      pub: createPublicClient({
        chain: { ...xLayer, rpcUrls: { default: { http: [rpcMain] } } },
        transport: http(rpcMain),
      }) as PublicClient,
      deployment,
    };
  } catch (e) {
    process.stderr.write(`no chain reads: ${(e as Error).message}\n`);
  }
  // A52: what the server reads on a visitor's behalf (adoption papers, the tree's names and colours, the numbers, a
  // room's name colours, the agent API) goes to X Layer's official host the jobs do not read from, falling back to the
  // jobs' node only when that fails, so visitors can never get the jobs' node to throttle us; on any other node (a
  // fork) both are that node
  const officialHosts = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
  const visitorUrls = officialHosts.includes(rpcMain)
    ? [...officialHosts.filter((u) => u !== rpcMain), rpcMain]
    : [rpcMain];
  // the jobs' node, when it is the fallback, is on a budget (A81): a busy minute of visitors never lands on it whole
  const jobsNode = createPublicClient({ transport: http(rpcMain, { timeout: 10_000 }) });
  const visitorTransports = visitorUrls.map((u) =>
    officialHosts.includes(rpcMain) && u === rpcMain
      ? custom({ request: budgetedRequest((args) => jobsNode.request(args as never)) })
      : http(u, { timeout: 10_000 }),
  );
  const visitorPub = createPublicClient({
    chain: { ...xLayer, rpcUrls: { default: { http: visitorUrls } } },
    transport: fallback(visitorTransports),
  }) as PublicClient;
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
    for (const [key, value] of Object.entries(fromRecord))
      if (process.env[key] === undefined && value !== undefined) process.env[key] = String(value);
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
    ownerOf: async (id) =>
      (await visitorPub.readContract({
        address: chainCtx!.deployment.registry,
        abi: petRegistryAbi,
        functionName: "ownerOf",
        args: [id],
      })) as `0x${string}`,
    nameColour: async (id) => (await nameColours(visitorPub, chainCtx!.deployment, [id]))[id.toString()] ?? 0,
  };
  const live = new LiveRooms(
    createDecorStore(process.env.LINGXI_DECOR_STORE),
    createHomes({ ...(homeChain ? { chain: homeChain } : {}), file: process.env.LINGXI_HOMES_STORE }),
  );
  const origins = (process.env.LINGXI_ORIGINS ?? "http://localhost:5199,http://localhost:4173").split(",");
  // what /api/health reports beyond its switches; chain reads are cached so a busy health check costs nothing
  const watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number } = {};
  let cached: { at: number; value: Record<string, unknown> } | null = null;
  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../data");
  const detail: HealthDetail = async () => {
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const [head, relayerWei, fees] = await Promise.all([
      watch.head?.().catch(() => null) ?? null,
      relayer?.balance().catch(() => null) ?? null,
      relayer?.fees().catch(() => null) ?? null,
    ]);
    // how many more tape-outs the relayer's BEM pays the transistor fee for (two kinds minted each, at most) (A40)
    const bemTapeouts =
      fees && fees.feeIn === "bem" && fees.protocolFee > 0n ? Number(fees.bem / (fees.protocolFee * 2n)) : null;
    const value = {
      jobs: Object.fromEntries(
        jobs.status().map((j) => [j.name, j.healthy ? "ok" : `failing: ${j.lastError?.message ?? "?"}`]),
      ),
      // which background jobs have finished a first pass (P3a): a fresh fork answers slowly until they have
      jobsRan: Object.fromEntries(jobs.status().map((j) => [j.name, j.lastOk !== undefined || j.failures > 0])),
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
      modelTokensToday: client
        ? {
            used: modelBudget.used(),
            perDay: modelBudget.perDay,
            perAddress: modelBudget.perAddress,
            ...modelBudget.measured(),
          }
        : null,
      backup: backupStatus(),
      watchdog: watchdogStatus(),
      // P3b: the build this server runs (dist/build.json beside it), or "source" when it runs through tsx; the status
      // check holds it to the checkout
      server: serverBuild(),
      // the process's own memory, in MB: a store or cache growing without end shows here first
      memoryMb: Object.fromEntries(
        Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1e5) / 10]),
      ),
      storesKb: await storeSizes(dataDir),
    };
    cached = { at: Date.now(), value };
    return value;
  };
  // who may keep a pet, read from PetRegistry on X Layer at the moment of the request
  const isKeeper: KeeperCheck | undefined = chainCtx
    ? async (petId, who) =>
        (await chainCtx!.pub.readContract({
          address: chainCtx!.deployment.registry,
          abi: petRegistryAbi,
          functionName: "isKeeper",
          args: [BigInt(petId), who],
        })) as boolean
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
        const yes = (await chainCtx!.pub.readContract({
          address: chainCtx!.deployment.registry,
          abi: petRegistryAbi,
          functionName: "isSettled",
          args: [BigInt(petId)],
        })) as boolean;
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
          return {
            brainId: p.brainId.toString(),
            parents: p.parentA && p.parentB ? [p.parentA.toString(), p.parentB.toString()] : null,
          };
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
    const file =
      process.env.LINGXI_MAIL_FILE ?? resolve(dirname(fileURLToPath(import.meta.url)), "../mail/letters.json");
    const letters = loadLetters(file);
    withMail(app, () => letters);
  }
  // whether the free keep is on, for the numbers page (C2): set where the gate is made
  let sponsorOn = () => false;
  {
    // a pet kept on X Layer for a player with no wallet (H4): it spends the relayer's OKB, so it is off unless the
    // server is started with LINGXI_SPONSOR=on; a store that cannot be read turns it off rather than forget who had one
    let sponsoring: Sponsoring | null = null;
    sponsorOn = () => !!sponsoring?.gate.enabled;
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
  const seasons = createSeasonStore(
    process.env.LINGXI_SEASON_STORE,
    Date.now,
    createStandingsRunner({ file: process.env.LINGXI_STANDINGS_FILE ?? join(dataDir, "standings.json") }),
  );
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
              const circuit = await loadCircuitFromChain(visitorPub, onChain.processor, onChain.brainId, undefined, {
                cache: seasonNetlists,
              });
              return { fast: circuitBrain(circuit), nState: circuit.nState };
            },
            // the comparison itself runs off the request thread, with a budget (A62)
            circuitOf: async (id) => {
              const onChain = await readPet(visitorPub, chainCtx!.deployment, BigInt(id));
              return loadCircuitFromChain(visitorPub, onChain.processor, onChain.brainId, undefined, {
                cache: seasonNetlists,
              });
            },
            check: mindChecker,
          })
      : undefined;
  withSeason(app, seasons, undefined, undefined, prove);
  {
    // the open agent API reads pets from the deployment the game runs on
    const rpc = rpcMain;
    const chain = chainCtx;
    withAgentApi(app, {
      agents: createAgentStore(process.env.LINGXI_AGENT_STORE),
      seasons,
      ...(chain ? { chain: { ...chain, pub: visitorPub } } : {}),
    });
    // the MCP server (TAP-15): reading a pet, running a spar, proposing a lesson
    const toolDeps = chain ? { chain: { ...chain, pub: visitorPub } } : {};
    withMcp(app, toolDeps);
    // the same operations as TAP-13 methods, every answer signed by the key the published manifest names (H7)
    const tapKey = readEnvFile(process.env.LINGXI_TAP_KEY_FILE).TAP_SIGNER_PRIVATE_KEY;
    if (tapKey) {
      try {
        const file =
          process.env.LINGXI_TAP_MANIFEST ??
          resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/.well-known/tapeapi.json");
        const manifest = JSON.parse(readFileSync(file, "utf8")) as {
          container: `0x${string}`;
          signer: string;
          delegation: { expires: number };
          methods: Array<{ name: string }>;
          mcp?: { toolsSha256: string };
        };
        const signer = privateKeyToAccount(tapKey as `0x${string}`);
        if (signer.address !== manifest.signer) throw new Error("the signing key is not the manifest's signer");
        if (manifest.delegation.expires <= Date.now() / 1000) throw new Error("the manifest's delegation has expired");
        // a tool is bound when the manifest lists a method of its name (TAP-15 §4.1); calls are held to its digest
        const names = manifest.methods.map((m) => m.name).filter((n) => MCP_TOOLS.some((t) => t.name === n));
        const tools = manifest.mcp
          ? { sha256: manifest.mcp.toolsSha256, names, mcp: (m: object) => handleMcp(m, toolDeps) }
          : undefined;
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
    withRpcProxy(
      app,
      official.includes(rpc)
        ? { upstreams: official.filter((u) => u !== rpc), reserve: { url: rpc, perMinute: 60 } }
        : { upstreams: [rpc] },
    );
    // adoption papers (plan 4.8): posted by the owner of a pet on offer, fetched by the buyer's game
    if (chain?.deployment.adoptionCentre) {
      const { deployment } = chain;
      const pub = visitorPub;
      withPapers(app, createPapersStore(process.env.LINGXI_PAPERS_STORE), {
        ownerOf: async (id) =>
          (await pub.readContract({
            address: deployment.registry,
            abi: petRegistryAbi,
            functionName: "ownerOf",
            args: [id],
          })) as `0x${string}`,
        sellerOf: async (id) => {
          const row = (await pub.readContract({
            address: deployment.adoptionCentre!,
            abi: adoptionCentreAbi,
            functionName: "listings",
            args: [id],
          })) as readonly [`0x${string}`, bigint, bigint, `0x${string}`];
          return /^0x0{40}$/i.test(row[0]) ? null : row[0];
        },
      });
    }
    withMove(app, createMoveStore());
    // short duel links: a duel code kept under the start of its own hash (A32)
    withDuels(app, createDuelStore(process.env.LINGXI_DUELS_DIR ?? join(dataDir, "duels")));
    // A34: the daily challenge's block, the first X Layer mainnet block of each UTC day, found once from mainnet's
    // official nodes (whatever chain the game runs on: the challenge is seeded by mainnet) and served same-origin
    const dailyNodes = createPublicClient({
      chain: xLayer,
      transport: fallback(official.map((u) => http(u, { timeout: 8_000 }))),
    });
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
        const [p, head] = await Promise.all([
          readPet(visitorPub, chain!.deployment, BigInt(id)),
          visitorPub.getBlock(),
        ]);
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
        const to = (await chainCtx.pub.readContract({
          address: chainCtx.deployment.registry,
          abi: petRegistryAbi,
          functionName: "ownerOf",
          args: [BigInt(petId)],
        })) as `0x${string}`;
        const r = await relayer.keepsake(
          {
            line: entry.pet.line,
            lessons: card.lessons,
            instincts: card.instincts,
            family: card.family,
            growth: card.growth,
          },
          to,
        );
        if (!r.ok) process.stderr.write(`season keepsake failed: ${r.reason} ${r.detail ?? ""}\n`);
        return r.ok
          ? { ok: true, brainId: r.brainId, to, tapeTx: r.tapeTx, sendTx: r.sendTx }
          : { ok: false, detail: r.detail };
      });
    jobs.after("season keepsakes (first)", 30_000, giveKeepsakes);
    jobs.every("season keepsakes", 10 * 60_000, giveKeepsakes);
  }
  if (process.env.LINGXI_REGISTRY && process.env.LINGXI_REGISTRY_FROM) {
    // P3: a fresh server's pet history starts from the snapshot in the repo when it walks the same registry (snapshot.ts)
    seedStore(
      SNAPSHOT_DIR,
      "history",
      process.env.LINGXI_HISTORY_STORE,
      (m) =>
        snapshotFits(m, "history", {
          registry: process.env.LINGXI_REGISTRY,
          registryFrom: Number(process.env.LINGXI_REGISTRY_FROM),
        }),
      (l) => console.log(l),
    );
    const indexer = createIndexer({
      rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech",
      registry: process.env.LINGXI_REGISTRY as `0x${string}`,
      fromBlock: Number(process.env.LINGXI_REGISTRY_FROM),
      store: process.env.LINGXI_HISTORY_STORE,
    });
    withHistory(app, indexer);
    watch.indexed = () => indexer.head();
    const headClient = createPublicClient({
      transport: http(process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech", { timeout: 10_000 }),
    });
    watch.head = () => headClient.getBlockNumber({ cacheTime: 0 });
    const look = process.env.LINGXI_LOOK as `0x${string}` | undefined;
    withTree(
      app,
      indexer,
      look
        ? async (id) =>
            String(
              await visitorPub.readContract({
                address: look,
                abi: lookAbi,
                functionName: "nameOf",
                args: [BigInt(id)],
              }),
            )
        : undefined,
      chainCtx?.deployment.extras
        ? (ids) =>
            nameColours(
              visitorPub,
              chainCtx!.deployment,
              ids.map((x) => BigInt(x)),
            )
        : undefined,
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
      const own = Object.values(chainCtx.deployment).filter(
        (v): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v),
      );
      withSourcify(app, createSourcifyRelay({ allowed: own, base: process.env.LINGXI_SOURCIFY_URL }));
    }
    // every breeding consent standing on X Layer (A63): the breeders keep them where no page can list them
    {
      const d = chainCtx?.deployment;
      const breeders = [d?.breeder, d?.breederFree].filter((a): a is `0x${string}` => !!a);
      const from = Number(process.env.LINGXI_CONSENTS_FROM ?? d?.registryBlock ?? 0);
      if (breeders.length && from > 0) {
        const consents = createConsentIndex({
          rpc: process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech",
          breeders,
          fromBlock: from,
          store: process.env.LINGXI_CONSENTS_STORE ?? join(dataDir, "consents.json"),
        });
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
        ...(chainCtx?.deployment.deployer
          ? { earns: { project: chainCtx.deployment.deployer, feeBps: 300, treasury: chainCtx.deployment.deployer } }
          : {}),
      },
      { address: env("LINGXI_MARKET_BEM"), fromBlock: Number(process.env.LINGXI_MARKET_BEM_FROM ?? 0) },
    ].filter(
      (m): m is { address: `0x${string}`; fromBlock: number; earns?: EarningTerms } => !!m.address && m.fromBlock > 0,
    );
    // the team's own wallets (C2): the deployer and the relayer, named on the page; any further wallet of the team's
    // is listed in data/team.json (kept out of the repo) and counted apart without being named
    const teamPublic = [chainCtx?.deployment.deployer, relayer?.address]
      .filter((a): a is `0x${string}` => !!a)
      .map((a) => a.toLowerCase());
    const teamPrivate = readTeamFile(process.env.LINGXI_TEAM_FILE ?? join(dataDir, "team.json")).filter(
      (a) => !teamPublic.includes(a),
    );
    const teamAll = [...teamPublic, ...teamPrivate];
    seedStore(
      SNAPSHOT_DIR,
      "sales",
      process.env.LINGXI_SALES_STORE,
      (m) => snapshotFits(m, "sales", { markets }),
      (l) => console.log(l),
    );
    const sales = createSalesCounter({ rpc, markets, team: teamAll, store: process.env.LINGXI_SALES_STORE });
    jobs.loop("sales", () => sales.catchUp(), 20_000);
    // the OKB market's listings a sale retired, which V1 itself would still sell (A23); the game shows none without it
    const okb = markets.find((m) => m.address === env("LINGXI_MARKET_OKB"));
    if (okb) {
      const listingWatch = createListingWatch({
        rpc,
        market: okb.address,
        fromBlock: okb.fromBlock,
        store: process.env.LINGXI_MARKET_V1_STORE ?? join(dataDir, "market-v1.json"),
      });
      withRetiredListings(app, listingWatch);
      jobs.loop("okb listings", () => listingWatch.catchUp(), 20_000);
    }
    // circuits on other processors that use Lingxi's by REF (H6): every processor TapeOut's factory made, read a little
    // each pass, progress kept
    const processor = (process.env.LINGXI_PROCESSOR ?? chainCtx?.deployment.processor) as `0x${string}` | undefined;
    const refs = processor
      ? createRefScanner({
          rpc,
          factory: FACTORY,
          ours: processor,
          store: process.env.LINGXI_REFS_STORE ?? join(dataDir, "refs.json"),
        })
      : undefined;
    if (refs) jobs.loop("refs", () => refs.catchUp(), 120_000);
    // who holds each TapeCode-Test1, so a holder claims the holder pin without typing a number (H9); the collection is
    // the one the gift contract itself names
    if (chainCtx?.deployment.holderGift) {
      const giftPub = chainCtx.pub;
      const gift = chainCtx.deployment.holderGift;
      const test1 = createTest1Index({
        pub: giftPub,
        collection: async () =>
          (await giftPub.readContract({ address: gift, abi: holderGiftAbi, functionName: "test1" })) as `0x${string}`,
      });
      withTest1Owners(app, test1);
      jobs.loop("test1 owners", () => test1.refresh(), TEST1_REFRESH_MS);
    }
    // circuits Lingxi has taped out: the processor's mints, walked from its deploy block (H10)
    // LINGXI_PROCESSOR_FROM starts the walk later (a fork of mainnet starts at its own block)
    const processorBlock =
      Number(process.env.LINGXI_PROCESSOR_FROM ?? chainCtx?.deployment.processorBlock ?? 0) || undefined;
    const circuitsStore = process.env.LINGXI_CIRCUITS_STORE ?? join(dataDir, "circuits.json");
    if (processor && processorBlock)
      seedStore(
        SNAPSHOT_DIR,
        "circuits",
        circuitsStore,
        (m) => snapshotFits(m, "circuits", { processor, processorFrom: processorBlock }),
        (l) => console.log(l),
      );
    const circuitCounter =
      processor && processorBlock
        ? createCircuitCounter({
            rpc,
            processor,
            fromBlock: processorBlock,
            ...(chainCtx?.deployment.processorBlock ? { deployBlock: Number(chainCtx.deployment.processorBlock) } : {}),
            store: circuitsStore,
          })
        : null;
    if (circuitCounter) jobs.loop("circuits", () => circuitCounter.catchUp(), 20_000);
    // the relayer's hatches are sponsored keeps; every other pet was kept by its owner's wallet or another (H10)
    const sponsors = relayer ? [relayer.address] : [];
    withNumbers(app, {
      pub: visitorPub,
      counts: (since) => indexer.counts(since),
      petsIndexedTo: () => indexer.head(),
      sales,
      ...(refs ? { refs } : {}),
      activity: (since) => indexer.activity(since),
      team: {
        wallets: teamPublic.map((a) => getAddress(a)),
        hidden: teamPrivate.length,
        byTeam: (since) => indexer.byTeam(teamAll, since),
      },
      sponsorOn,
      keepers: () => indexer.keepers(sponsors),
      sponsors,
      ...(circuitCounter && processor && processorBlock
        ? { circuits: { processor, counter: circuitCounter, fromBlock: processorBlock } }
        : {}),
      contracts: {
        registry: process.env.LINGXI_REGISTRY as `0x${string}`,
        marketOkb: env("LINGXI_MARKET_OKB"),
        marketBem: env("LINGXI_MARKET_BEM"),
        breeder: env("LINGXI_BREEDER"),
        gift: env("LINGXI_GIFT"),
        itemShop: env("LINGXI_ITEM_SHOP"),
        adoption: env("LINGXI_ADOPTION"),
        extras: env("LINGXI_EXTRAS") ?? chainCtx?.deployment.extras,
      },
      explorer: "https://www.oklink.com/xlayer",
    });
    // community goals: every contribution read from the registry and every BEM burner
    const burners = [
      env("LINGXI_BREEDER"),
      env("LINGXI_MARKET_BEM"),
      env("LINGXI_ITEM_SHOP"),
      env("LINGXI_ADOPTION"),
      env("LINGXI_EXTRAS") ?? chainCtx?.deployment.extras,
    ].filter((a): a is `0x${string}` => !!a);
    seedStore(
      SNAPSHOT_DIR,
      "goals",
      process.env.LINGXI_GOALS_STORE,
      (m) =>
        snapshotFits(m, "goals", {
          registry: process.env.LINGXI_REGISTRY,
          registryFrom: Number(process.env.LINGXI_REGISTRY_FROM),
        }),
      (l) => console.log(l),
    );
    const ledger = createGoalLedger({
      rpc,
      registry: process.env.LINGXI_REGISTRY as `0x${string}`,
      burners,
      fromBlock: Number(process.env.LINGXI_REGISTRY_FROM),
      store: process.env.LINGXI_GOALS_STORE,
    });
    withGoals(app, ledger);
    // keepsake vouchers (plan 4.6): signed only for contributors to a completed goal, with the voucher key
    const voucherKey = readEnvFile(process.env.LINGXI_VOUCHER_KEY_FILE).VOUCHER_PRIVATE_KEY;
    if (voucherKey) {
      try {
        const file =
          process.env.LINGXI_DEPLOYMENT ??
          resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/chain/deployments/xlayer.json");
        const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
        withVouchers(app, {
          entries: () => ledger.entries(),
          signer: privateKeyToAccount(voucherKey as `0x${string}`),
          deployment,
        });
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
  process.stdout.write(
    `lingxi api on ${hostname}:${port} (teaching ${client ? "on" : "off: no key"}, relaying ${relayer ? "on" : "off"}, reminders ${pusher ? "on" : "off"})\n`,
  );
}
