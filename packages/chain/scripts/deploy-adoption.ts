/**
 * Deploys the adoption centre (plan 4.8) against the deployment's registry and BEM, and records it.
 * Reads before it writes: an existing centre on record is checked and kept. Every value is read back.
 *
 *   tsx scripts/deploy-adoption.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { adoptionCentreAbi } from "../src/adoptionCentreAbi";
import { outfitMarketV2Abi } from "../src/outfitMarketV2Abi";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

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
say(`deployer ${account.address}, ${formatEther(start)} OKB; registry ${d.registry}; BEM ${bem}`);

let centre = d.adoptionCentre;
if (!centre) {
  const art = JSON.parse(
    readFileSync(resolve(here, "../../../contracts/out/AdoptionCentre.sol/AdoptionCentre.json"), "utf8"),
  );
  const tx = await wallet.deployContract({
    abi: art.abi,
    bytecode: art.bytecode.object as Hex,
    args: [d.registry, bem, account.address],
  });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`deploy failed ${tx}`);
  centre = r.contractAddress as Address;
  say(`AdoptionCentre ${centre} tx ${tx}`);
  const cur = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(
    file,
    `${JSON.stringify({ ...cur, adoptionCentre: centre, adoptionCentreBlock: Number(r.blockNumber), adoptionCentreTx: tx }, null, 2)}\n`,
  );
}
const read = (functionName: "registry" | "bem" | "owner" | "feeBps") =>
  pub.readContract({ address: centre, abi: adoptionCentreAbi, functionName }) as Promise<unknown>;
const [reg, token, owner, fee] = await Promise.all([read("registry"), read("bem"), read("owner"), read("feeBps")]);
const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
if (!same(reg, d.registry) || !same(token, bem) || !same(owner, account.address) || Number(fee) !== 300)
  throw new Error(`read back: registry ${reg}, BEM ${token}, owner ${owner}, fee ${fee}`);
const end = await pub.getBalance({ address: account.address });
say(`done: centre ${centre}, fee 3%, owner ${owner}; spent ${formatEther(start - end)} OKB`);
