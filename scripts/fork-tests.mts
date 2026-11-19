/**
 * `pnpm test:fork`: the server's tests with its fork tests switched on. It forks X Layer mainnet at the end-to-end
 * suite's pinned block (`e2e/fork.json`, after every Lingxi deployment), funds a relayer from the public test mnemonic
 * with OKB and BEM written into the fork, points the tests at it (`FORK_RPC`, `RELAY_KEY_FILE`, `DEPLOYMENT_FILE`), runs
 * `vitest run` in `services/api` with any arguments given (`pnpm test:fork --coverage`), and stops the fork after.
 * Nothing leaves this machine but reads of X Layer: the fork and every balance on it are local.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, toHex, type Address, type PublicClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
// the suite's harness compiles as CommonJS (the repo root has no module type), so it is taken whole
import procs from "../e2e/harness/procs.ts";
import { assertLocal, giveOkb, giveToken } from "../packages/chain/scripts/lib/forkFund.ts";

const { answers, freePort, start, stop, waitFor } = procs;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fork = JSON.parse(readFileSync(join(root, "e2e/fork.json"), "utf8")) as { block: number; rpc: string };
/** Foundry's and Hardhat's public test mnemonic: its keys hold nothing anywhere real. */
const relayer = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 7 });

const dir = mkdtempSync(join(tmpdir(), "lingxi-fork-tests-"));
const port = await freePort();
const rpc = `http://127.0.0.1:${port}`;
assertLocal(rpc);
const anvil = start("anvil", process.env.ANVIL_BIN ?? "anvil", ["--fork-url", process.env.LINGXI_E2E_UPSTREAM ?? fork.rpc, "--fork-block-number", String(fork.block), "--port", String(port), "--chain-id", "196", "--silent"], { cwd: dir, env: process.env, log: join(dir, "anvil.log") });
let status = 1;
try {
  await waitFor("the fork", () => answers(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }), 60_000, anvil.log);
  const pub = createPublicClient({ transport: http(rpc, { timeout: 60_000 }) }) as PublicClient;
  const deployment = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<string, unknown> & { itemShop: Address };
  const deploymentFile = join(dir, "deployment.json");
  writeFileSync(deploymentFile, JSON.stringify({ ...deployment, rpc }, null, 2));
  const bem = (await pub.readContract({ address: deployment.itemShop, abi: [{ type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const, functionName: "bem" })) as Address;
  // a public test address may carry delegation code on X Layer that a stranger set; on the fork it is a plain wallet
  if (((await pub.getCode({ address: relayer.address })) ?? "0x") !== "0x") await pub.request({ method: "anvil_setCode" as never, params: [relayer.address, "0x"] as never });
  await giveOkb(pub, relayer.address, 100n * 10n ** 18n);
  await giveToken(pub, bem, relayer.address, 10_000n * 10n ** 18n);
  const keyFile = join(dir, "relayer.env");
  writeFileSync(keyFile, `K=${toHex(relayer.getHdKey().privateKey!)}\n`);

  const vitest = join(root, "node_modules/vitest/vitest.mjs");
  // one file at a time: the fork tests share one relayer, and two of them sending at once would race for its nonce
  const run = spawnSync(process.execPath, [vitest, "run", "--no-file-parallelism", ...process.argv.slice(2)], {
    cwd: join(root, "services/api"),
    stdio: "inherit",
    env: { ...process.env, FORK_RPC: rpc, RELAY_KEY_FILE: keyFile, DEPLOYMENT_FILE: deploymentFile },
  });
  status = run.status ?? 1;
} finally {
  stop(anvil);
  // kept after a failure, so the fork's log can be read
  if (status === 0) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  else console.error(`fork tests failed; the fork's log and files are in ${dir}`);
}
process.exit(status);
