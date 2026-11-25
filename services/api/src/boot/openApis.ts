/**
 * The server's open doors (P7: out of server.ts's boot).
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { readEnvFile } from "../envFile";
import { SERVICE_DIR } from "../paths";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { createSeasonStore } from "../season";
import { dayIndex } from "@lingxi/game";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { type Deployment, adoptionCentreAbi, petRegistryAbi, readPet, xLayer } from "@lingxi/chain";
import { createAgentStore } from "../agents";
import { withAgentApi } from "../agentApi";
import { withTapApi } from "../tapApi";
import { handleMcp, withMcp } from "../mcp";
import { MCP_TOOLS } from "../mcpToolDefs";
import { createPapersStore, withPapers } from "../papers";
import { withRpcProxy } from "../rpc";
import { privateKeyToAccount } from "viem/accounts";
import { createDuelStore, withDuels } from "../duels";
import { createDailyBlocks, withDaily } from "../daily";
import { createDiaryStore } from "../diaries";
import { createMoveStore } from "../move";
import { createTapeoutCounter, withLane } from "../lane";
import { factoryReader } from "../laneReader";
import { createJobs } from "../jobs";
import { withMove } from "../routes/play";
import { withDiaries } from "../routes/chainReads";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "../routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "../routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "../routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "../routes/chainReads";

/**
 * The open doors: the agent API, the MCP server, TAP-13 signed answers (H7), the browser's door to X Layer,
 * adoption papers, moves, duel links, the daily challenge's block, the tape-out lane, and diaries.
 */
export function mountOpenApis({
  jobs,
  rpcMain,
  chainCtx,
  visitorPub,
  dataDir,
  app,
  seasons,
}: {
  jobs: ReturnType<typeof createJobs>;
  rpcMain: string;
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  visitorPub: PublicClient;
  dataDir: string;
  app: Hono;
  seasons: ReturnType<typeof createSeasonStore>;
}) {
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
        process.env.LINGXI_TAP_MANIFEST ?? resolve(SERVICE_DIR, "../../apps/web/public/.well-known/tapeapi.json");
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
      const [p, head] = await Promise.all([readPet(visitorPub, chain!.deployment, BigInt(id)), visitorPub.getBlock()]);
      return { logHash: p.logHash, born: p.born, at: Number(head.timestamp) };
    });
}
