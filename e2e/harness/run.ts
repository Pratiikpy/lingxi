/**
 * Everything the end-to-end suite plays against, started from nothing and stopped after: a fork of X Layer mainnet at
 * a pinned block (after every Lingxi deployment, so the real contracts are there), funded test wallets, the server
 * with empty stores in a scratch folder, and the game's dev server twice, one per player's wallet.
 *
 * Nothing here touches a real chain: the fork runs on this machine, the wallets are derived from the public test
 * mnemonic every Foundry and Hardhat install ships, and their balances are written into the fork.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPublicClient, http, toHex, type Address, type PublicClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { assertLocal, giveOkb, giveToken } from "../../packages/chain/scripts/lib/forkFund";
import { type PinnedFork, type Started, answers, forkArgs, freePort, start, stop, stopSaving, waitFor } from "./procs";

export const ROOT = resolve(__dirname, "../..");
const FORK = JSON.parse(readFileSync(join(ROOT, "e2e/fork.json"), "utf8")) as PinnedFork;
/** Foundry's and Hardhat's public test mnemonic: its keys hold nothing anywhere real. */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const PLAYERS = 4;
/** The test wallet the server relays with (the last one). */
export const RELAYER = PLAYERS - 1;
const OKB_EACH = 100n * 10n ** 18n;
const BEM_EACH = 10_000n * 10n ** 18n;

export interface Player {
  index: number;
  address: Address;
  /** the game's dev server signing with this player's wallet */
  web: string;
}

export interface Run {
  dir: string;
  fork: { rpc: string; block: number };
  api: string;
  players: Player[];
  /** every process this run started, to stop after */
  procs: Array<Pick<Started, "name" | "pid" | "log">>;
}

/** A test wallet's account; its key never leaves this process except into the game's dev server it signs for. */
export const testAccount = (index: number) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index });
const keyOf = (index: number) => toHex(testAccount(index).getHdKey().privateKey!);

const node = process.execPath;
const tsx = join(ROOT, "node_modules/tsx/dist/cli.mjs");
const vite = join(ROOT, "apps/web/node_modules/vite/bin/vite.js");

export async function startRun(): Promise<Run> {
  const dir = join(ROOT, "e2e/.run", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(join(dir, "stores"), { recursive: true });
  const procs: Run["procs"] = [];
  const keep = (p: Started) => {
    procs.push({ name: p.name, pid: p.pid, log: p.log });
    return p;
  };
  try {
    // the fork, at the pinned block
    const forkPort = await freePort();
    const rpc = `http://127.0.0.1:${forkPort}`;
    assertLocal(rpc);
    const anvil = keep(
      start("anvil", process.env.ANVIL_BIN ?? "anvil", forkArgs(FORK, forkPort), {
        cwd: dir,
        env: process.env,
        log: join(dir, "anvil.log"),
      }),
    );
    await waitFor(
      "the fork",
      () =>
        answers(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        }),
      60_000,
      anvil.log,
    );
    const pub = createPublicClient({ transport: http(rpc) }) as PublicClient;
    // the fork's new blocks start at the real time, as mainnet's do: by default anvil carries on from the pinned
    // block's own time (18 Nov 2026), and the server counts "the last 7 days" from the real clock, so from 25 Nov
    // every hatch on the fork fell outside the week (P7a's CI run, numbers-week)
    await pub.request({ method: "evm_setTime" as never, params: [Math.floor(Date.now() / 1000)] as never });

    // the deployment record, pointed at the fork
    const deployment = JSON.parse(readFileSync(join(ROOT, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<
      string,
      unknown
    > & { itemShop: Address };
    const deploymentFile = join(dir, "deployment.json");
    writeFileSync(deploymentFile, JSON.stringify({ ...deployment, rpc }, null, 2));

    // funded test wallets: OKB for gas and purchases, BEM for the shops
    const bem = (await pub.readContract({
      address: deployment.itemShop,
      abi: [
        { type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
      ] as const,
      functionName: "bem",
    })) as Address;
    const addresses = Array.from({ length: PLAYERS }, (_, i) => testAccount(i).address);
    for (const a of addresses) {
      // the test mnemonic's addresses are public, and on X Layer some carry EIP-7702 delegation code a stranger set,
      // which refuses the pet a registry mints to them: on the fork they are made plain wallets again
      if (((await pub.getCode({ address: a })) ?? "0x") !== "0x")
        await pub.request({ method: "anvil_setCode" as never, params: [a, "0x"] as never });
      await giveOkb(pub, a, OKB_EACH);
      await giveToken(pub, bem, a, BEM_EACH);
    }

    // the server, with every store in the scratch folder and its indexes starting at the fork
    const apiPort = await freePort();
    const api = `http://127.0.0.1:${apiPort}`;
    const webPorts = await Promise.all(addresses.slice(0, 2).map(() => freePort()));
    const origins = webPorts.map((p) => `http://localhost:${p}`);
    const s = (f: string) => join(dir, "stores", f);
    mkdirSync(s("diaries"), { recursive: true });
    // a stand-in for Sourcify, so no spec depends on Sourcify being up (A71)
    const sourcifyPort = await freePort();
    keep(
      start("sourcify", node, [join(ROOT, "e2e/harness/sourcify-standin.mjs"), String(sourcifyPort)], {
        cwd: dir,
        env: process.env,
        log: join(dir, "sourcify.log"),
      }),
    );
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(apiPort),
      LINGXI_HOST: "127.0.0.1",
      LINGXI_RPC: rpc,
      LINGXI_DEPLOYMENT: deploymentFile,
      LINGXI_ORIGINS: origins.join(","),
      LINGXI_REGISTRY_FROM: String(FORK.block),
      LINGXI_PACKETS_FROM: String(FORK.block),
      LINGXI_MARKET_OKB_FROM: String(FORK.block),
      LINGXI_MARKET_BEM_FROM: String(FORK.block),
      LINGXI_PROCESSOR_FROM: String(FORK.block),
      LINGXI_CONSENTS_FROM: String(FORK.block),
      LINGXI_SOURCIFY_URL: `http://127.0.0.1:${sourcifyPort}/server`,
      ...Object.fromEntries(
        [
          ["LINGXI_DECOR_STORE", "decor.json"],
          ["LINGXI_HOMES_STORE", "homes.json"],
          ["LINGXI_HISTORY_STORE", "history.json"],
          ["LINGXI_SALES_STORE", "sales.json"],
          ["LINGXI_GOALS_STORE", "goals.json"],
          ["LINGXI_PAPERS_STORE", "papers.json"],
          ["LINGXI_SIT_STORE", "sit.json"],
          ["LINGXI_ARENA_STORE", "arena.json"],
          ["LINGXI_SEASON_STORE", "season.json"],
          ["LINGXI_AGENT_STORE", "agent.json"],
          ["LINGXI_LIBRARY_STORE", "library.json"],
          ["LINGXI_BRAIN_STORE", "brains.json"],
          ["LINGXI_PACKETS_STORE", "packets.json"],
          ["LINGXI_CIRCUITS_STORE", "circuits.json"],
          ["LINGXI_TEAM_FILE", "team.json"],
          ["LINGXI_CONSENTS_STORE", "consents.json"],
          ["LINGXI_PUSH_STORE", "push.json"],
          ["LINGXI_LANE_FILE", "lane.json"],
          ["LINGXI_DIARY_DIR", "diaries"],
          ["LINGXI_DUELS_DIR", "duels"],
          ["LINGXI_DAILY_FILE", "daily.json"],
          ["LINGXI_STANDINGS_FILE", "standings.json"],
          ["LINGXI_RELAY_QUOTA_FILE", "relay-quota.json"],
          ["LINGXI_SPONSOR_STORE", "sponsored.json"],
          // P3a: the OKB market's listings and the processors' references, once written into the repo's own data folder
          ["LINGXI_MARKET_V1_STORE", "market-v1.json"],
          ["LINGXI_REFS_STORE", "refs.json"],
        ].map(([k, f]) => [k, s(f!)]),
      ),
    };
    for (const k of ["LINGXI_VOUCHER_KEY_FILE", "LINGXI_PUSH_KEY_FILE", "LINGXI_STATIC"]) delete serverEnv[k];
    // the relayer that tapes out players' brains: the last test wallet, funded on the fork; its key stays in the
    // scratch folder of this run
    writeFileSync(
      s("relayer.env"),
      `K=${keyOf(RELAYER)}
`,
    );
    serverEnv.LINGXI_RELAYER_KEY_FILE = s("relayer.env");
    // keeping a pet with no wallet (H4) is switched on here, on the fork, so its screens are played before it is on for
    // real players (B9); its own limits stay as they are: one free pet per network a day, every spec on 127.0.0.1
    serverEnv.LINGXI_SPONSOR = "on";
    // one server serves every spec of a run, and every pet on the fork is new: Lingxi's own hourly sponsorship and its
    // newcomers' share would run out partway through the suite. Those limits are proven by the API's own tests (A40);
    // here every spec's tape-out is sponsored
    serverEnv.LINGXI_RELAY_PER_HOUR = "1000";
    serverEnv.LINGXI_RELAY_NEWCOMER_SHARE = "1";
    // no model: the secrets file has a default path on this machine, so it is pointed at one that does not exist,
    // and a spec never spends on a paid model or depends on its answer
    serverEnv.LINGXI_SECRETS = join(dir, "no-secrets.env");
    // the key that codes players' addresses (P6a) is the suite's own: its default sits beside the live server's stores
    serverEnv.LINGXI_IP_KEY_FILE = join(dir, "ip-key");
    const server = keep(
      start("server", node, [tsx, "src/server.ts"], {
        cwd: join(ROOT, "services/api"),
        env: serverEnv,
        log: join(dir, "server.log"),
      }),
    );
    await waitFor("the server", () => answers(`${api}/api/health`), 90_000, server.log);
    const health = (await (await fetch(`${api}/api/health`)).json()) as {
      teach?: boolean;
      voice?: boolean;
      relay?: boolean;
    };
    if (health.teach || health.voice) throw new Error("the suite's server can reach a paid model; it must not");
    if (!health.relay) throw new Error("the suite's server has no relayer");
    // the server's first reading of Builders' Lane loads hundreds of processors the fork has never touched, and the
    // fork answers nothing else quickly until it is done: specs start after it
    await waitFor(
      "the server's first reading of the chain",
      async () => ((await (await fetch(`${api}/api/lane/tapeouts`)).json()) as { ok?: boolean }).ok === true,
      300_000,
      server.log,
    );
    // P3a: and so does every other background reading (who holds each Test1, the processors' references, the markets): on
    // a fork each first pass fetches thousands of storage slots from X Layer one by one, and a player's transaction waits
    // behind them, so the first spec of a run timed out on CI. Specs start once every job has finished a first pass
    let slow: string[] = [];
    await waitFor(
      "every background reading's first pass",
      async () => {
        const h = (await (await fetch(`${api}/api/health`)).json()) as {
          detail?: { jobsRan?: Record<string, boolean> };
        };
        slow = Object.entries(h.detail?.jobsRan ?? { "the health report": false })
          .filter(([, ran]) => !ran)
          .map(([name]) => name);
        return slow.length === 0;
      },
      900_000,
      server.log,
    ).catch((e: unknown) => {
      throw new Error(`${e instanceof Error ? e.message : String(e)}; still on their first pass: ${slow.join(", ")}`);
    });

    // the game, once per player's wallet
    const players: Player[] = [];
    for (const [i, port] of webPorts.entries()) {
      const web = `http://localhost:${port}`;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        LINGXI_E2E: "1",
        LINGXI_VITE_CACHE: join(dir, `vite-cache-${i}`),
        VITE_CHAIN: "rehearsal",
        VITE_RPC: rpc,
        VITE_API_URL: api,
        VITE_LIVE_URL: `${api.replace("http", "ws")}/live`,
        VITE_DEV_KEY: keyOf(i),
      };
      const p = keep(
        start(`web${i}`, node, [vite, "--port", String(port), "--strictPort", "--host", "localhost"], {
          cwd: join(ROOT, "apps/web"),
          env,
          log: join(dir, `web${i}.log`),
        }),
      );
      await waitFor(`the game for player ${i}`, () => answers(`${web}/play.html`), 90_000, p.log);
      await warmUp(web, p.log);
      players.push({ index: i, address: addresses[i]!, web });
    }
    for (const a of addresses.slice(2)) players.push({ index: players.length, address: a, web: "" });

    const run: Run = { dir, fork: { rpc, block: FORK.block }, api, players, procs };
    // each run keeps its own record, so two runs on one machine never read each other's; the specs find it by the
    // environment the global setup hands its workers
    writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2));
    process.env.LINGXI_E2E_RUN = join(dir, "run.json");
    return run;
  } catch (e) {
    for (const p of procs.reverse()) stop(p);
    throw e;
  }
}

/**
 * Opens the game once in a browser and waits for the hatch screen, so the dev server has transformed and bundled
 * everything the first page needs before any spec plays. A page that could not load (the server still bundling a
 * dependency it just found) is loaded again, up to three times; then the run stops and says so.
 */
async function warmUp(web: string, log: string): Promise<void> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (let attempt = 1; ; attempt++) {
      await page.goto(`${web}/play.html`, { timeout: 120_000 });
      const shown = await page
        .locator(".hatch, #load-failed-title")
        .first()
        .waitFor({ timeout: 120_000 })
        .then(
          async () => ((await page.locator(".hatch").count()) ? "game" : "failed"),
          () => "nothing",
        );
      if (shown === "game") return;
      if (attempt === 3) throw new Error(`the game at ${web} would not load in a browser (${shown}); see ${log}`);
    }
  } finally {
    await browser.close();
  }
}

export async function stopRun(run: Pick<Run, "procs" | "dir">): Promise<void> {
  // anvil last, and gently, so it saves the state it fetched for the next run (stopSaving)
  for (const p of [...run.procs].reverse()) {
    if (p.name === "anvil") await stopSaving(p);
    else stop(p);
  }
  // the logs and stores stay for a look; the dev servers' bundled dependencies (most of a run's size) do not
  for (const name of readdirSync(run.dir))
    if (name.startsWith("vite-cache-")) rmSync(join(run.dir, name), { recursive: true, force: true, maxRetries: 3 });
}

/** The run the global setup started, for a spec to read. */
export function currentRun(): Run {
  const file = process.env.LINGXI_E2E_RUN;
  if (!file)
    throw new Error("no run: start specs with `pnpm e2e`, whose global setup starts the fork, the server and the game");
  return JSON.parse(readFileSync(file, "utf8")) as Run;
}
