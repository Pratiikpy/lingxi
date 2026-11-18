/**
 * Everything the end-to-end suite plays against, started from nothing and stopped after: a fork of X Layer mainnet at
 * a pinned block (after every Lingxi deployment, so the real contracts are there), funded test wallets, the server
 * with empty stores in a scratch folder, and the game's dev server twice, one per player's wallet.
 *
 * Nothing here touches a real chain: the fork runs on this machine, the wallets are derived from the public test
 * mnemonic every Foundry and Hardhat install ships, and their balances are written into the fork.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPublicClient, http, toHex, type Address, type PublicClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { assertLocal, giveOkb, giveToken } from "../../packages/chain/scripts/lib/forkFund";
import { type Started, answers, freePort, start, stop, waitFor } from "./procs";

export const ROOT = resolve(__dirname, "../..");
const FORK = JSON.parse(readFileSync(join(ROOT, "e2e/fork.json"), "utf8")) as { block: number; rpc: string };
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
    const upstream = process.env.LINGXI_E2E_UPSTREAM ?? FORK.rpc;
    const anvil = keep(start("anvil", process.env.ANVIL_BIN ?? "anvil", ["--fork-url", upstream, "--fork-block-number", String(FORK.block), "--port", String(forkPort), "--chain-id", "196", "--silent"], { cwd: dir, env: process.env, log: join(dir, "anvil.log") }));
    await waitFor("the fork", () => answers(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }), 60_000, anvil.log);
    const pub = createPublicClient({ transport: http(rpc) }) as PublicClient;

    // the deployment record, pointed at the fork
    const deployment = JSON.parse(readFileSync(join(ROOT, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<string, unknown> & { itemShop: Address };
    const deploymentFile = join(dir, "deployment.json");
    writeFileSync(deploymentFile, JSON.stringify({ ...deployment, rpc }, null, 2));

    // funded test wallets: OKB for gas and purchases, BEM for the shops
    const bem = (await pub.readContract({ address: deployment.itemShop, abi: [{ type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const, functionName: "bem" })) as Address;
    const addresses = Array.from({ length: PLAYERS }, (_, i) => testAccount(i).address);
    for (const a of addresses) {
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
          ["LINGXI_PUSH_STORE", "push.json"],
          ["LINGXI_LANE_FILE", "lane.json"],
          ["LINGXI_DIARY_DIR", "diaries"],
        ].map(([k, f]) => [k, s(f!)]),
      ),
    };
    for (const k of ["LINGXI_VOUCHER_KEY_FILE", "LINGXI_PUSH_KEY_FILE", "LINGXI_STATIC"]) delete serverEnv[k];
    // the relayer that tapes out players' brains: the last test wallet, funded on the fork; its key stays in the
    // scratch folder of this run
    writeFileSync(s("relayer.env"), `K=${keyOf(RELAYER)}
`);
    serverEnv.LINGXI_RELAYER_KEY_FILE = s("relayer.env");
    // no model: the secrets file has a default path on this machine, so it is pointed at one that does not exist,
    // and a spec never spends on a paid model or depends on its answer
    serverEnv.LINGXI_SECRETS = join(dir, "no-secrets.env");
    const server = keep(start("server", node, [tsx, "src/server.ts"], { cwd: join(ROOT, "services/api"), env: serverEnv, log: join(dir, "server.log") }));
    await waitFor("the server", () => answers(`${api}/api/health`), 90_000, server.log);
    const health = (await (await fetch(`${api}/api/health`)).json()) as { teach?: boolean; voice?: boolean; relay?: boolean };
    if (health.teach || health.voice) throw new Error("the suite's server can reach a paid model; it must not");
    if (!health.relay) throw new Error("the suite's server has no relayer");

    // the game, once per player's wallet
    const players: Player[] = [];
    for (const [i, port] of webPorts.entries()) {
      const web = `http://localhost:${port}`;
      const env: NodeJS.ProcessEnv = { ...process.env, LINGXI_E2E: "1", VITE_CHAIN: "rehearsal", VITE_RPC: rpc, VITE_API_URL: api, VITE_LIVE_URL: `${api.replace("http", "ws")}/live`, VITE_DEV_KEY: keyOf(i) };
      const p = keep(start(`web${i}`, node, [vite, "--port", String(port), "--strictPort", "--host", "localhost"], { cwd: join(ROOT, "apps/web"), env, log: join(dir, `web${i}.log`) }));
      await waitFor(`the game for player ${i}`, () => answers(`${web}/play.html`), 90_000, p.log);
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

export function stopRun(run: Pick<Run, "procs">): void {
  for (const p of [...run.procs].reverse()) stop(p);
}

/** The run the global setup started, for a spec to read. */
export function currentRun(): Run {
  const file = process.env.LINGXI_E2E_RUN;
  if (!file) throw new Error("no run: start specs with `pnpm e2e`, whose global setup starts the fork, the server and the game");
  return JSON.parse(readFileSync(file, "utf8")) as Run;
}
