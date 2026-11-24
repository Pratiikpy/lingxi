/**
 * Deploys the paid extras (plan 4.9) against the deployment's registry and BEM, and records it.
 * Reads before it writes: an existing contract on record is checked and kept. Every value is read back.
 *
 *   tsx scripts/deploy-extras.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NAME_COLOURS } from "@lingxi/world";
import { extrasAbi } from "../src/extrasAbi";
import { outfitMarketV2Abi } from "../src/outfitMarketV2Abi";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

/** 0.05 BEM for each extra (BEM has 8 decimals), as plan 4.9 section 5 sets. */
export const EXTRA_PRICE = 5_000_000n;

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const say = (s: string) => process.stdout.write(`${s}\n`);

const file = arg("deployment")!;
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes"))
  throw new Error("refusing a non-local node without --mainnet-yes");
const env = Object.fromEntries(
  readFileSync(arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as Hex);
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });
const start = await pub.getBalance({ address: account.address });
// BEM is the token the BEM market is paid in, read from the market rather than typed here
const bem = (await pub.readContract({
  address: d.outfitMarketV2!,
  abi: outfitMarketV2Abi,
  functionName: "bem",
})) as Address;
const colours = NAME_COLOURS.length;
say(`deployer ${account.address}, ${formatEther(start)} OKB; registry ${d.registry}; BEM ${bem}; ${colours} colours`);

let extras = d.extras;
if (!extras) {
  const art = JSON.parse(readFileSync(resolve(here, "../../../contracts/out/Extras.sol/Extras.json"), "utf8"));
  const tx = await wallet.deployContract({
    abi: art.abi,
    bytecode: art.bytecode.object as Hex,
    args: [account.address, bem, d.registry, colours, EXTRA_PRICE, EXTRA_PRICE, EXTRA_PRICE],
  });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`deploy failed ${tx}`);
  extras = r.contractAddress as Address;
  say(`Extras ${extras} tx ${tx}`);
  const cur = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(
    file,
    `${JSON.stringify({ ...cur, extras, extrasBlock: Number(r.blockNumber), extrasTx: tx }, null, 2)}\n`,
  );
}
const read = (functionName: string, args: readonly unknown[] = []) =>
  pub.readContract({ address: extras, abi: extrasAbi, functionName, args } as never) as Promise<unknown>;
const [token, pets, owner, n, pRoom, pLooks, pColour, burned] = await Promise.all([
  read("bem"),
  read("pets"),
  read("owner"),
  read("colours"),
  read("price", [0]),
  read("price", [1]),
  read("price", [2]),
  read("totalBurned"),
]);
const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
if (
  !same(token, bem) ||
  !same(pets, d.registry) ||
  !same(owner, account.address) ||
  Number(n) !== colours ||
  [pRoom, pLooks, pColour].some((p) => p !== EXTRA_PRICE)
) {
  throw new Error(
    `read back: BEM ${token}, pets ${pets}, owner ${owner}, colours ${n}, prices ${pRoom}/${pLooks}/${pColour}`,
  );
}
const end = await pub.getBalance({ address: account.address });
say(
  `done: extras ${extras}, ${colours} colours, 0.05 BEM each, owner ${owner}, burned so far ${burned}; spent ${formatEther(start - end)} OKB`,
);
