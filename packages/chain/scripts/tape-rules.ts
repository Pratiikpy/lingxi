/**
 * Tape out the game's rules as circuits on the deployment's processor (plan 4.11) and record their ids.
 *
 *   tsx scripts/tape-rules.ts --deployment deployments/xlayer.json --rpc <url> [--key-file <path>] [--mainnet-yes]
 *
 * Idempotent: a rule already on record whose stored netlist matches is left alone; a rule with no record, or whose
 * circuit no longer matches the rule here, is taped out again and its record replaced. Every circuit is read back
 * and compared byte for byte before it is recorded. The key is read from a file, never the command line. Gates come
 * from the deployer's own stock (a rule circuit is a few hundred); the script stops before spending if the stock is short.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ruleNetlist } from "@lingxi/brain";
import { RULES, type RuleRecord, ruleHex } from "../src/rules";
import { processorAbi, transistorsAbi, xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const say = (s: string) => process.stdout.write(`${s}\n`);

const deploymentFile = resolve(process.cwd(), arg("deployment", "deployments/local.json")!);
const rpc = arg("rpc", "http://127.0.0.1:8547")!;
const keyFile = arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!;
const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as { chainId: number; processor: Address; rules?: Record<string, RuleRecord> };

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

const chainId = await pub.getChainId();
const local = rpc.includes("127.0.0.1") || rpc.includes("localhost");
if (!local && !process.argv.includes("--mainnet-yes")) throw new Error(`refusing to write to ${rpc} (chain ${chainId}) without --mainnet-yes`);
const processor = deployment.processor;
const records: Record<string, RuleRecord> = { ...(deployment.rules ?? {}) };

async function stored(id: string, tries = 1): Promise<Hex | null> {
  for (let i = 0; i < tries; i++) {
    try {
      return (await pub.readContract({ address: processor, abi: processorAbi, functionName: "netlist", args: [BigInt(id)] })) as Hex;
    } catch {
      // a load-balanced endpoint may answer from a node a block behind the write: wait and ask again
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

const todo = [];
for (const rule of RULES) {
  const rec = records[rule.name];
  if (rec && (await stored(rec.id))?.toLowerCase() === ruleHex(rule).toLowerCase()) {
    say(`  ${rule.name}: circuit ${rec.id} matches, kept`);
    continue;
  }
  todo.push(rule);
}
const need = todo.reduce((n, r) => n + BigInt(ruleNetlist(r).gates.length), 0n);
const start = await pub.getBalance({ address: account.address });
say(`deployer ${account.address}, ${formatEther(start)} OKB; processor ${processor}; ${todo.length} of ${RULES.length} rules to tape out, ${need} NAND gates`);
if (todo.length === 0) process.exit(0);

const transistors = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "transistors" })) as Address;
const held = (await pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [account.address, 0n] })) as bigint;
if (held < need) throw new Error(`the deployer holds ${held} NAND gates and these rules need ${need}; mint more first`);
const fee = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "TAPEOUT_FEE" })) as bigint;
say(`tape-out fee ${formatEther(fee)} OKB each, ${formatEther(fee * BigInt(todo.length))} OKB in all, plus gas`);

for (const rule of todo) {
  const net = ruleNetlist(rule);
  const hex = ruleHex(rule);
  const { result: id } = await pub.simulateContract({ address: processor, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: fee, account });
  const tx = await wallet.writeContract({ address: processor, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: fee });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${rule.name}: tapeout failed ${tx}`);
  let back = await stored(String(id), 5);
  for (let i = 0; i < 4 && back?.toLowerCase() !== hex.toLowerCase(); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    back = await stored(String(id), 3);
  }
  if (back?.toLowerCase() !== hex.toLowerCase()) throw new Error(`${rule.name}: circuit ${id} (tx ${tx}) does not read back as ours; record it by hand after checking`);
  records[rule.name] = { id: String(id), tx, gates: net.gates.length };
  say(`  ${rule.name}: circuit ${id} (${net.gates.length} NAND) tx ${tx}`);
  // written after each one, so an interrupted run keeps what it paid for
  writeFileSync(deploymentFile, JSON.stringify({ ...JSON.parse(readFileSync(deploymentFile, "utf8")), rules: records }, null, 2) + "\n");
}
const end = await pub.getBalance({ address: account.address });
say(`done: spent ${formatEther(start - end)} OKB; wrote ${deploymentFile}`);
