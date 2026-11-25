/**
 * The Lingxi deployment on X Layer, in one ordered script that is rehearsed on a
 * fork with the real wallet and real balances before it ever runs on mainnet.
 *
 *   tsx scripts/deploy-xlayer.ts --rpc <url> [--key-file <path>] [--out <json>] [--mainnet-yes]
 *
 * Steps (each reads before it writes, and stops at the first surprise):
 *   1. preflight: chain 196, factory fees, balances, the full plan and its cost
 *   2. our own processor through TapeOut's factory (createCPU, 0.1 BEM)
 *   3. a transistor pool (NAND and LATCH, mint price 0, TapeOut's 0.01 BEM per mint)
 *   4. tape out the three starter brains, the evolution circuit and the red packet seal
 *   5. PetRegistry + starter approvals, Breeder, RedPacket
 *   6. read everything back: netlists byte-for-byte, circuit info, owners, wiring
 *   7. write the deployment file
 * Without --mainnet-yes it refuses to send anything to a non-local node.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARTERS, bytesToHex, compileProgram, compileSeal, gateCount, netlistBytes } from "@lingxi/brain";
import { EVOLUTION } from "@lingxi/game";
import { FACTORY, factoryAbi, processorAbi, transistorsAbi, xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const rpc = arg("rpc", "http://127.0.0.1:8548")!;
const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc);
if (!local && !process.argv.includes("--mainnet-yes"))
  throw new Error("refusing to send to a non-local node without --mainnet-yes");
const keyFile = arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!;
const outFile = arg("out", resolve(here, local ? "../deployments/rehearsal.json" : "../deployments/xlayer.json"))!;

/** What goes on chain permanently: choose once. */
const PROCESSOR = {
  name: "Lingxi",
  symbol: "LINGXI",
  story:
    "Lingxi (灵犀): pets whose minds are TapeOut circuits with LATCH memory. Each pet's brain is taped out here; children's brains REF both parents. Every thought can be replayed with step.",
  supply: 100_000_000n,
  mintPrice: 0n,
};
/** Transistors minted up front for the brains we tape out and for the relayer's first players. */
const POOL = { nand: 60_000n, latch: 6_000n };
/** The tokens red packets may hold on X Layer: USDT and USD₮0 (both 6 decimals, not rebasing). */
const USDT: Address = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";
const USDT0: Address = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";

const env = Object.fromEntries(
  readFileSync(keyFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount((env.DEPLOYER_PRIVATE_KEY ?? env.K) as Hex);
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });
const say = (s: string) => process.stdout.write(`${s}\n`);
const art = (name: string) =>
  JSON.parse(readFileSync(resolve(here, `../../../contracts/out/${name}.sol/${name}.json`), "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };

/** Sends a simulated or hand-built contract call and waits for it; any failure stops the deploy. */
async function send(label: string, req: object): Promise<Hex> {
  const tx = await wallet.writeContract(req as never);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${label} failed: ${tx}`);
  say(`  ${label}: ${tx} (gas ${r.gasUsed})`);
  return tx;
}

async function main() {
  // 1. preflight
  const chainId = await pub.getChainId();
  if (chainId !== 196) throw new Error(`chain ${chainId} is not X Layer`);
  const bem = (await pub.readContract({
    address: FACTORY,
    abi: [
      { type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    ] as const,
    functionName: "bem",
  })) as Address;
  const deployFee = (await pub.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "deployFee",
  })) as bigint;
  const okb0 = await pub.getBalance({ address: account.address });
  const bem0 = (await pub.readContract({
    address: bem,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  const nets = {
    gentle: compileProgram(STARTERS.gentle),
    bold: compileProgram(STARTERS.bold),
    curious: compileProgram(STARTERS.curious),
    evolution: compileProgram(EVOLUTION),
    seal: compileSeal(),
  };
  say(`deployer ${account.address} on ${local ? "a LOCAL FORK (rehearsal)" : "X LAYER MAINNET"}`);
  say(
    `balances: ${formatEther(okb0)} OKB, ${formatUnits(bem0, 8)} BEM; createCPU fee ${formatUnits(deployFee, 8)} BEM`,
  );
  for (const [k, n] of Object.entries(nets))
    say(`  circuit ${k}: ${gateCount(n)} gates (${n.gates.length} NAND, ${n.latches.length} LATCH)`);
  const needBem = deployFee + 2n * 1_000_000n;
  if (bem0 < needBem) throw new Error(`need at least ${formatUnits(needBem, 8)} BEM`);

  // 2. our processor
  await send("approve BEM for createCPU", {
    address: bem,
    abi: erc20Abi,
    functionName: "approve",
    args: [FACTORY, deployFee],
    account,
    chain,
  });
  const factoryCreate = [
    {
      type: "function",
      name: "createCPU",
      stateMutability: "payable",
      inputs: [
        { name: "name", type: "string" },
        { name: "symbol", type: "string" },
        { name: "story", type: "string" },
        { name: "transistorSupply", type: "uint256" },
        { name: "mintPrice", type: "uint256" },
      ],
      outputs: [
        { name: "transistors", type: "address" },
        { name: "circuits", type: "address" },
      ],
    },
  ] as const;
  const sim = await pub.simulateContract({
    address: FACTORY,
    abi: factoryCreate,
    functionName: "createCPU",
    args: [PROCESSOR.name, PROCESSOR.symbol, PROCESSOR.story, PROCESSOR.supply, PROCESSOR.mintPrice],
    account,
  });
  const [transistors, processor] = sim.result as readonly [Address, Address];
  await send(`createCPU → processor ${processor}, transistors ${transistors}`, sim.request);
  if (!(await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCPU", args: [processor] })))
    throw new Error("factory does not list the new processor");

  // 3. transistor pool
  for (const [id, amount] of [
    [0n, POOL.nand],
    [1n, POOL.latch],
  ] as const) {
    const fee = (await pub.readContract({
      address: transistors,
      abi: transistorsAbi,
      functionName: "protocolFee",
    })) as bigint;
    const price = (await pub.readContract({
      address: transistors,
      abi: transistorsAbi,
      functionName: "mintPrice",
    })) as bigint;
    await send(`approve BEM for mint ${id}`, {
      address: bem,
      abi: erc20Abi,
      functionName: "approve",
      args: [transistors, fee],
      account,
      chain,
    });
    const m = await pub.simulateContract({
      address: transistors,
      abi: transistorsAbi,
      functionName: "mint",
      args: [id, amount],
      value: price * amount,
      account,
    });
    await send(`mint ${amount} of transistor ${id} (protocol fee ${formatUnits(fee, 8)} BEM)`, m.request);
  }

  // 4. circuits
  const circuits: Record<string, { id: string; tx: string; gates: number }> = {};
  const tapeFee = (await pub.readContract({
    address: processor,
    abi: processorAbi,
    functionName: "TAPEOUT_FEE",
  })) as bigint;
  for (const [k, n] of Object.entries(nets)) {
    const hex = bytesToHex(netlistBytes(n)) as Hex;
    const t = await pub.simulateContract({
      address: processor,
      abi: processorAbi,
      functionName: "tapeout",
      args: [hex, 16, 8],
      value: tapeFee,
      account,
    });
    const tx = await send(`tape out ${k}`, t.request);
    const id = t.result as bigint;
    const stored = (await pub.readContract({
      address: processor,
      abi: processorAbi,
      functionName: "netlist",
      args: [id],
    })) as Hex;
    if (stored.toLowerCase() !== hex.toLowerCase()) throw new Error(`${k}: stored netlist differs`);
    circuits[k] = { id: id.toString(), tx, gates: gateCount(n) };
  }

  // 5. contracts
  const reg = art("PetRegistry");
  const regTx = await wallet.deployContract({
    abi: reg.abi,
    bytecode: reg.bytecode.object,
    args: [FACTORY, account.address],
    account,
    chain,
  });
  const regR = await pub.waitForTransactionReceipt({ hash: regTx });
  const registry = regR.contractAddress as Address;
  say(`  PetRegistry ${registry}: ${regTx}`);
  for (const line of ["gentle", "bold", "curious"])
    await send(`approve starter ${line}`, {
      address: registry,
      abi: reg.abi,
      functionName: "setStarterBrain",
      args: [processor, BigInt(circuits[line]!.id), true],
      account,
      chain,
    } as never);
  const br = art("Breeder");
  const brTx = await wallet.deployContract({
    abi: br.abi,
    bytecode: br.bytecode.object,
    args: [registry],
    account,
    chain,
  });
  const breeder = (await pub.waitForTransactionReceipt({ hash: brTx })).contractAddress as Address;
  say(`  Breeder ${breeder}: ${brTx}`);
  await send("let the Breeder hatch children", {
    address: registry,
    abi: reg.abi,
    functionName: "setBreeder",
    args: [breeder, true],
    account,
    chain,
  } as never);
  const rp = art("RedPacket");
  const rpTx = await wallet.deployContract({
    abi: rp.abi,
    bytecode: rp.bytecode.object,
    args: [processor, BigInt(circuits.seal!.id), registry, account.address, [USDT, USDT0]],
    account,
    chain,
  });
  const rpR = await pub.waitForTransactionReceipt({ hash: rpTx });
  const redPacket = rpR.contractAddress as Address;
  say(`  RedPacket ${redPacket}: ${rpTx}`);

  // 6. read back
  const regAbi = reg.abi as never;
  for (const line of ["gentle", "bold", "curious"]) {
    const ok = await pub
      .readContract({
        address: registry,
        abi: regAbi,
        functionName: "starterBrain",
        args: [processor, BigInt(circuits[line]!.id)],
      })
      // the read-back is the deploy's proof: a starter it could not read is not taken as approved (below)
      .catch(() => null);
    if (ok === null) throw new Error(`starter ${line}: the read-back of its approval failed; run the read-back again`);
    if (ok === false) throw new Error(`starter ${line} not approved`);
  }
  if (!(await pub.readContract({ address: registry, abi: regAbi, functionName: "breeders", args: [breeder] })))
    throw new Error("breeder not set");
  const rpAbi = rp.abi as never;
  if (
    ((await pub.readContract({ address: redPacket, abi: rpAbi, functionName: "sealId" })) as bigint).toString() !==
    circuits.seal!.id
  )
    throw new Error("red packet seal mismatch");
  for (const [k, c] of Object.entries(circuits)) {
    const info = (await pub.readContract({
      address: processor,
      abi: processorAbi,
      functionName: "circuitInfo",
      args: [BigInt(c.id)],
    })) as readonly bigint[];
    if (Number(info[0]) !== 16 || Number(info[1]) !== 8) throw new Error(`${k}: circuit info ${info.join(",")}`);
  }

  const okb1 = await pub.getBalance({ address: account.address });
  const bem1 = (await pub.readContract({
    address: bem,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  say(
    `spent ${formatEther(okb0 - okb1)} OKB and ${formatUnits(bem0 - bem1, 8)} BEM; left ${formatEther(okb1)} OKB, ${formatUnits(bem1, 8)} BEM`,
  );
  const out = {
    chainId,
    rpc: local ? rpc : "https://rpc.xlayer.tech",
    processor,
    transistors,
    registry,
    breeder,
    redPacket,
    seal: circuits.seal!.id,
    redPacketBlock: Number(rpR.blockNumber),
    deployer: account.address,
    circuits,
    at: new Date().toISOString(),
  };
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  say(`wrote ${outFile}`);
  void parseEventLogs;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
