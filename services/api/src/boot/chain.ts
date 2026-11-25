/**
 * The chain the server reads (P7: out of server.ts's boot).
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { SERVICE_DIR } from "../paths";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, custom, fallback, http, type PublicClient } from "viem";
import { type Deployment, nameColours, packsHeld, petRegistryAbi, piecesHeld, xLayer } from "@lingxi/chain";
import { type HomeChain } from "../homes";
import { budgetedRequest } from "../visitorBudget";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "../routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "../routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "../routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "../routes/chainReads";

/**
 * The deployment the game runs on, read once, and the client that reads X Layer on a visitor's behalf (A52); every
 * contract address and start block not set by hand is filled in from the deployment record.
 */
export function readChain({ rpcMain }: { rpcMain: string }) {
  let chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  try {
    const file = process.env.LINGXI_DEPLOYMENT ?? resolve(SERVICE_DIR, "../../packages/chain/deployments/xlayer.json");
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
  return { chainCtx, visitorPub };
}

/**
 * Homes (plan 4.9): what visitors see is what the home's linked wallets hold on X Layer.
 */
export function homeChainOf({
  chainCtx,
  visitorPub,
}: {
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  visitorPub: PublicClient;
}) {
  // homes (plan 4.9): what visitors see is what the home's linked wallets hold on X Layer
  const homeChain: HomeChain | undefined = chainCtx && {
    roomPacks: async (wallets) => (await packsHeld(visitorPub, chainCtx.deployment, wallets)).room,
    piecesHeld: (wallets) => piecesHeld(visitorPub, chainCtx.deployment, wallets),
    ownerOf: async (id) =>
      (await visitorPub.readContract({
        address: chainCtx.deployment.registry,
        abi: petRegistryAbi,
        functionName: "ownerOf",
        args: [id],
      })) as `0x${string}`,
    nameColour: async (id) => (await nameColours(visitorPub, chainCtx.deployment, [id]))[id.toString()] ?? 0,
  };
  return { homeChain };
}
