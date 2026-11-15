/**
 * Deploys the fashion market (OutfitMarket) and records it in the deployment file.
 * The deployer is the owner; the market fee goes to the deployer's address until
 * the owner names another treasury.
 *
 *   tsx scripts/deploy-outfits.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { outfitMarketAbi } from "../src/outfitMarketAbi";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const file = arg("deployment")!;
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes")) throw new Error("refusing a non-local node without --mainnet-yes");
const env = Object.fromEntries(
  readFileSync(arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount((env.DEPLOYER_PRIVATE_KEY ?? env.K) as Hex);
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });
const art = JSON.parse(readFileSync(resolve(here, "../../../contracts/out/OutfitMarket.sol/OutfitMarket.json"), "utf8")) as { bytecode: { object: Hex } };

async function main() {
  const before = await pub.getBalance({ address: account.address });
  const hash = await wallet.deployContract({ abi: outfitMarketAbi, bytecode: art.bytecode.object, args: [account.address, account.address] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error("deploy failed");
  const market = r.contractAddress;
  // read it back before recording it
  const [owner, treasury, fee] = await Promise.all([
    pub.readContract({ address: market, abi: outfitMarketAbi, functionName: "owner" }),
    pub.readContract({ address: market, abi: outfitMarketAbi, functionName: "treasury" }),
    pub.readContract({ address: market, abi: outfitMarketAbi, functionName: "feeBps" }),
  ]);
  if (owner !== account.address || treasury !== account.address || Number(fee) !== 300) throw new Error("the deployed market does not read back as configured");
  writeFileSync(file, JSON.stringify({ ...d, outfitMarket: market, outfitMarketBlock: Number(r.blockNumber) }, null, 2) + "\n");
  const after = await pub.getBalance({ address: account.address });
  console.log(`OutfitMarket ${market} at block ${r.blockNumber} (tx ${hash}); owner and treasury ${account.address}; fee 3%; cost ${formatEther(before - after)} OKB`);
}
main().catch((e) => (console.error(e), process.exit(1)));
