/**
 * Tape out Lingxi brains on a TapeOut processor, then deploy PetRegistry and
 * approve the three starter brains as free hatching brains.
 *
 *   tsx scripts/tapeout.ts --rpc <url> --processor <address> [--key-file <path>] [--out <json>]
 *   tsx scripts/tapeout.ts --breeder-only [--key-file <path>] [--out <json>]
 *     adds the Breeder to an existing deployment (the registry owner's key)
 *
 * The key is read from a file (default tapeout/.secrets/deployer.env), never
 * from the command line. Every step reads before it writes and prints what it
 * costs. Works the same on a local fork and on X Layer mainnet.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARTERS, bytesToHex, compileProgram, gateCount, netlistBytes } from "@lingxi/brain";
import { EVOLUTION } from "@lingxi/game";
import { FACTORY, factoryAbi, processorAbi, transistorsAbi, xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const rpc = arg("rpc", "http://127.0.0.1:8547")!;
const here2 = here;
const breederOnly = process.argv.includes("--breeder-only");
const existing = breederOnly ? (JSON.parse(readFileSync(arg("out", resolve(here, "../deployments/local.json"))!, "utf8")) as Record<string, unknown>) : null;
const processor = (arg("processor") ?? (existing?.processor as string | undefined)) as Address | undefined;
const keyFile = arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!;
const outFile = arg("out", resolve(here, "../deployments/local.json"))!;
if (!processor) throw new Error("--processor is required");

const env = Object.fromEntries(
  readFileSync(keyFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const pk = (env.DEPLOYER_PRIVATE_KEY ?? env.K) as Hex;
if (!pk) throw new Error(`no key in ${keyFile}`);
const account = privateKeyToAccount(pk);
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });

/** Deploys the Breeder against a registry and lets it hatch children there. */
async function deployBreeder(registry: Address): Promise<Address> {
  const art = JSON.parse(readFileSync(resolve(here2, "../../../contracts/out/Breeder.sol/Breeder.json"), "utf8"));
  const reg = JSON.parse(readFileSync(resolve(here2, "../../../contracts/out/PetRegistry.sol/PetRegistry.json"), "utf8"));
  const tx = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args: [registry] });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  const breeder = r.contractAddress as Address;
  console.log(`Breeder ${breeder} tx ${tx}`);
  const set = await wallet.writeContract({ address: registry, abi: reg.abi, functionName: "setBreeder", args: [breeder, true] });
  const sr = await pub.waitForTransactionReceipt({ hash: set });
  if (sr.status !== "success") throw new Error("setBreeder failed");
  return breeder;
}

if (existing) {
  const breeder = await deployBreeder(existing.registry as Address);
  const outPath = arg("out", resolve(here, "../deployments/local.json"))!;
  writeFileSync(outPath, JSON.stringify({ ...existing, breeder, breederAt: new Date().toISOString() }, null, 2));
  console.log(`wrote ${outPath}`);
  process.exit(0);
}

const say = (s: string) => process.stdout.write(`${s}\n`);

async function mintIfShort(transistors: Address, id: bigint, need: bigint) {
  const have = (await pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [account.address, id] })) as bigint;
  if (have >= need) return;
  const amount = need - have;
  const price = (await pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "mintPrice" })) as bigint;
  const fee = (await pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "protocolFee" })) as bigint;
  const value = price * amount + fee;
  say(`  mint ${amount} of transistor ${id} for ${formatEther(value)} OKB`);
  const hash = await wallet.writeContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [id, amount], value });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`mint failed: ${hash}`);
}

async function tapeOut(name: string, bytes: Uint8Array, nIn: number, nOut: number, nands: number, latches: number): Promise<{ id: bigint; tx: Hex }> {
  const transistors = (await pub.readContract({ address: processor!, abi: processorAbi, functionName: "transistors" })) as Address;
  await mintIfShort(transistors, 0n, BigInt(nands));
  if (latches > 0) await mintIfShort(transistors, 1n, BigInt(latches));
  const fee = (await pub.readContract({ address: processor!, abi: processorAbi, functionName: "TAPEOUT_FEE" })) as bigint;
  const hex = bytesToHex(bytes) as Hex;
  const { result: id } = await pub.simulateContract({ address: processor!, abi: processorAbi, functionName: "tapeout", args: [hex, nIn, nOut], value: fee, account });
  const tx = await wallet.writeContract({ address: processor!, abi: processorAbi, functionName: "tapeout", args: [hex, nIn, nOut], value: fee });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`tapeout failed: ${tx}`);
  const stored = (await pub.readContract({ address: processor!, abi: processorAbi, functionName: "netlist", args: [id as bigint] })) as Hex;
  if (stored.toLowerCase() !== hex.toLowerCase()) throw new Error(`${name}: stored netlist differs from ours`);
  say(`  ${name}: circuit ${id} (${nands} NAND + ${latches} LATCH, fee ${formatEther(fee)} OKB) tx ${tx}`);
  return { id: id as bigint, tx };
}

async function main() {
  const isCpu = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCPU", args: [processor!] });
  if (!isCpu) throw new Error(`${processor} is not a registered processor`);
  const start = await pub.getBalance({ address: account.address });
  say(`deployer ${account.address}, balance ${formatEther(start)} OKB, processor ${processor}`);

  const circuits: Record<string, { id: string; tx: string; gates: number }> = {};
  for (const [line, program] of Object.entries(STARTERS)) {
    const net = compileProgram(program);
    const r = await tapeOut(`starter ${line}`, netlistBytes(net), 16, 8, net.gates.length, net.latches.length);
    circuits[line] = { id: r.id.toString(), tx: r.tx, gates: gateCount(net) };
  }
  const evo = compileProgram(EVOLUTION);
  const er = await tapeOut("evolution", netlistBytes(evo), 16, 8, evo.gates.length, 0);
  circuits.evolution = { id: er.id.toString(), tx: er.tx, gates: gateCount(evo) };

  // deploy PetRegistry from the Foundry build output
  const artifact = JSON.parse(readFileSync(resolve(here, "../../../contracts/out/PetRegistry.sol/PetRegistry.json"), "utf8"));
  const deployTx = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args: [FACTORY, account.address] });
  const dr = await pub.waitForTransactionReceipt({ hash: deployTx });
  const registry = dr.contractAddress as Address;
  say(`PetRegistry ${registry} tx ${deployTx}`);
  for (const line of Object.keys(STARTERS)) {
    const tx = await wallet.writeContract({ address: registry, abi: artifact.abi, functionName: "setStarterBrain", args: [processor!, BigInt(circuits[line]!.id), true] });
    const r = await pub.waitForTransactionReceipt({ hash: tx });
    if (r.status !== "success") throw new Error(`setStarterBrain ${line} failed`);
  }
  void parseEventLogs;
  const breeder = await deployBreeder(registry);
  const end = await pub.getBalance({ address: account.address });
  say(`spent ${formatEther(start - end)} OKB in total`);
  const out = { chainId: await pub.getChainId(), rpc, processor, registry, breeder, deployer: account.address, circuits, at: new Date().toISOString() };
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  say(`wrote ${outFile}`);
  void existsSync;
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
