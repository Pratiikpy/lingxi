/**
 * The registry's jobs (P7: out of server.ts's boot).
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
import { BrainRelayer } from "../relayer";
import { createPublicClient, getAddress, http, type PublicClient } from "viem";
import { FACTORY, type Deployment, holderGiftAbi, nameColours } from "@lingxi/chain";
import { TEST1_REFRESH_MS, createTest1Index, withTest1Owners } from "../test1Owners";
import { createIndexer } from "../indexer";
import { createPacketIndex } from "../packets";
import { createGoalLedger, withGoals } from "../goals";
import { withVouchers } from "../voucher";
import { createConsentIndex, withConsents } from "../consents";
import { createSourcifyRelay, withSourcify } from "../sourcify";
import { privateKeyToAccount } from "viem/accounts";
import {
  type EarningTerms,
  NUMBERS_REFRESH_MS,
  type NumbersDeps,
  createNumbersCache,
  createSalesCounter,
  withNumbers,
} from "../numbers";
import { createCircuitCounter } from "../circuits";
import { seedStore, snapshotFits } from "../snapshot";
import { readTeamFile } from "../team";
import { createRefScanner } from "../refScan";
import { createListingWatch, withRetiredListings } from "../marketV1";
import { petLookAbi as lookAbi } from "@lingxi/chain";
import { createJobs } from "../jobs";
import { withHistory, withPackets, withTree } from "../routes/chainReads";
import { SNAPSHOT_DIR } from "../routes/health";
/**
 * The chain's head as the health report reads it (P8): one request to the node, ten seconds at most, never from a
 * cache, so a node that has died is seen on the next reading. Its own function so the fork test that kills a node
 * (healthChain.fork.test.ts, R12) reads through exactly what the server does.
 */
export function chainHead(rpc: string): () => Promise<bigint> {
  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000 }) });
  return () => client.getBlockNumber({ cacheTime: 0 });
}

export { SITE_CACHE_MAX, scriptPolicy, withSite } from "../routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "../routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "../routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "../routes/chainReads";

/**
 * Everything read from the registry and the markets as X Layer moves: pet histories, the family tree, red
 * packets' claims, Sourcify's verdicts, breeding consents, the numbers, sales, REF scans, circuits and goals.
 */
export function startRegistryJobs({
  jobs,
  chainCtx,
  visitorPub,
  relayer,
  watch,
  dataDir,
  app,
  sponsorOn,
}: {
  jobs: ReturnType<typeof createJobs>;
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  visitorPub: PublicClient;
  relayer: BrainRelayer | null;
  watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number };
  dataDir: string;
  app: Hono;
  sponsorOn: () => boolean;
}) {
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
    watch.head = chainHead(process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech");
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
              chainCtx.deployment,
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
    const numbersDeps: NumbersDeps = {
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
    };
    // R74: the numbers are read at start and every 40 s after, so a visit is answered from the last read at once
    const numbers = createNumbersCache(numbersDeps);
    jobs.loop("numbers", () => numbers.refresh(), NUMBERS_REFRESH_MS);
    withNumbers(app, numbersDeps, numbers);
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
          process.env.LINGXI_DEPLOYMENT ?? resolve(SERVICE_DIR, "../../packages/chain/deployments/xlayer.json");
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
}
