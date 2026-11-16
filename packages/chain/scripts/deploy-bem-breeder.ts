/**
 * Deploys the BEM breeder (BreederV2), lets it hatch children in PetRegistry, switches the free breeder off,
 * and records the change in the deployment file. Every step is read back from the chain first.
 *
 *   tsx scripts/deploy-bem-breeder.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { breederV2Abi } from "../src/breederV2Abi";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const BEM: Address = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";
const registryAbi = parseAbi(["function setBreeder(address breeder, bool allowed)", "function breeders(address) view returns (bool)", "function owner() view returns (address)"]);

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};

async function main() {
  const file = arg("deployment")!;
  const d = JSON.parse(readFileSync(file, "utf8")) as Deployment & { breederFree?: Address };
  const rpc = arg("rpc", d.rpc)!;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes")) throw new Error("refusing a non-local node without --mainnet-yes");
  if (d.breederBem) throw new Error("this deployment already has the BEM breeder");
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
  const art = JSON.parse(readFileSync(resolve(here, "../../../contracts/out/BreederV2.sol/BreederV2.json"), "utf8")) as { bytecode: { object: Hex } };
  const wait = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`transaction failed: ${hash}`);
    return r;
  };
  if ((await pub.readContract({ address: d.registry, abi: registryAbi, functionName: "owner" })) !== account.address) throw new Error("the deployer does not own the registry");
  const before = await pub.getBalance({ address: account.address });

  const r = await wait(await wallet.deployContract({ abi: breederV2Abi, bytecode: art.bytecode.object, args: [d.registry, BEM, account.address] }));
  const breeder = r.contractAddress!;
  const read = <T>(fn: string) => pub.readContract({ address: breeder, abi: breederV2Abi, functionName: fn as never }) as Promise<T>;
  const [reg, bem, owner, fee, max] = await Promise.all([read<Address>("registry"), read<Address>("bem"), read<Address>("owner"), read<bigint>("breedFee"), read<number>("MAX_CHILDREN")]);
  if (reg.toLowerCase() !== d.registry.toLowerCase() || bem !== BEM || owner !== account.address || fee !== 10_000_000n || Number(max) !== 4) throw new Error("the breeder does not read back as configured");

  // the free breeder goes off first: no moment exists where both could hatch (the old one has no fee and no cap)
  const old = d.breeder;
  if (old) await wait(await wallet.writeContract({ address: d.registry, abi: registryAbi, functionName: "setBreeder", args: [old, false] }));
  await wait(await wallet.writeContract({ address: d.registry, abi: registryAbi, functionName: "setBreeder", args: [breeder, true] }));
  const [newOn, oldOn] = await Promise.all([
    pub.readContract({ address: d.registry, abi: registryAbi, functionName: "breeders", args: [breeder] }),
    old ? pub.readContract({ address: d.registry, abi: registryAbi, functionName: "breeders", args: [old] }) : Promise.resolve(false),
  ]);
  if (!newOn || oldOn) throw new Error("the registry's breeders do not read back as intended");

  writeFileSync(file, JSON.stringify({ ...d, breeder, breederBem: true, breederBlock: Number(r.blockNumber), ...(old ? { breederFree: old } : {}) }, null, 2) + "\n");
  const after = await pub.getBalance({ address: account.address });
  console.log(`BreederV2 ${breeder} (block ${r.blockNumber}); allowed in the registry; free breeder ${old ?? "none"} switched off; fee 0.1 BEM burned; cost ${formatEther(before - after)} OKB`);
}

main().catch((e) => (console.error(e), process.exit(1)));
