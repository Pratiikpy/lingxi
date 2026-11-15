/**
 * Reading and writing Lingxi pets on chain. Reads need no wallet; writes take
 * any viem wallet client (an injected wallet, Privy, or a local key in tests).
 */

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { petRegistryAbi } from "./registryAbi";
import { processorAbi } from "./tapeout";
import { type Circuit, REF, decode, hexToBytes, load, refKey } from "@lingxi/brain";

export interface Deployment {
  /** the Breeder contract, when families are deployed */
  breeder?: Address;
  /** red packet escrow and its seal circuit id, when deployed */
  redPacket?: Address;
  seal?: string;
  /** block the escrow was deployed at, to read its events from */
  redPacketBlock?: number;
  chainId: number;
  rpc: string;
  processor: Address;
  registry: Address;
  circuits: Record<string, { id: string; tx: string; gates: number }>;
}

export interface ChainPet {
  id: bigint;
  owner: Address;
  processor: Address;
  brainId: bigint;
  line: number;
  brainBits: number;
  day: number;
  born: number;
  checkedAt: number;
  logHash: Hex;
  state: bigint;
  parentA: bigint;
  parentB: bigint;
}

export async function readPet(pub: PublicClient, d: Deployment, id: bigint): Promise<ChainPet> {
  const [p, owner] = await Promise.all([
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "pet", args: [id] }),
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [id] }),
  ]);
  const x = p as unknown as Omit<ChainPet, "id" | "owner"> & { brainId: bigint; day: number };
  return {
    id,
    owner: owner as Address,
    processor: x.processor,
    brainId: BigInt(x.brainId),
    line: Number(x.line),
    brainBits: Number(x.brainBits),
    day: Number(x.day),
    born: Number(x.born),
    checkedAt: Number(x.checkedAt),
    logHash: x.logHash,
    state: BigInt(x.state),
    parentA: BigInt(x.parentA),
    parentB: BigInt(x.parentB),
  };
}

export async function replayStep(pub: PublicClient, d: Deployment, id: bigint, brainState: bigint, inputs: number): Promise<{ next: bigint; outputs: number }> {
  const [next, outputs] = (await pub.readContract({
    address: d.registry,
    abi: petRegistryAbi,
    functionName: "replayStep",
    args: [id, brainState, inputs],
  })) as readonly [bigint, number];
  return { next: BigInt(next), outputs: Number(outputs) };
}

export async function readNetlist(pub: PublicClient, processor: Address, id: bigint): Promise<{ bytes: Hex; nIn: number; nOut: number; nState: number; gates: number }> {
  const [bytes, info] = await Promise.all([
    pub.readContract({ address: processor, abi: processorAbi, functionName: "netlist", args: [id] }),
    pub.readContract({ address: processor, abi: processorAbi, functionName: "circuitInfo", args: [id] }),
  ]);
  const [nIn, nOut, nState, gates] = info as readonly [bigint, bigint, bigint, bigint];
  return { bytes: bytes as Hex, nIn: Number(nIn), nOut: Number(nOut), nState: Number(nState), gates: Number(gates) };
}

export async function hatchOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, line: number, lineName: string, initialState: bigint): Promise<{ petId: bigint; tx: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const brainId = BigInt(d.circuits[lineName]!.id);
  const { result, request } = await pub.simulateContract({
    address: d.registry,
    abi: petRegistryAbi,
    functionName: "hatch",
    args: [account.address, line, d.processor, brainId, initialState],
    account,
  });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("hatch failed");
  return { petId: result as bigint, tx };
}

export async function checkpointOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, day: number, state: bigint, logHash: Hex): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({
    address: d.registry,
    abi: petRegistryAbi,
    functionName: "checkpoint",
    args: [petId, day, state, logHash],
    account,
  });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("checkpoint failed");
  return tx;
}

/** Let `who` keep the pet (write checkpoints) until `until` (seconds); owner only, at most 30 days. */
export async function setSitterOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, who: Address, until: bigint): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({ address: d.registry, abi: petRegistryAbi, functionName: "setSitter", args: [petId, who, until], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("setSitter failed");
  return tx;
}

/** Who sits the pet and until when (seconds), and whether `who` may write its checkpoints right now. */
export async function readKeeping(pub: PublicClient, d: Deployment, petId: bigint, who: Address): Promise<{ sitter: Address; until: number; keeper: boolean }> {
  const [s, keeper] = await Promise.all([
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "sitters", args: [petId] }) as Promise<readonly [Address, bigint, Address]>,
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "isKeeper", args: [petId, who] }) as Promise<boolean>,
  ]);
  return { sitter: s[0], until: Number(s[1]), keeper };
}

export async function setBrainOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, processor: Address, brainId: bigint): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({
    address: d.registry,
    abi: petRegistryAbi,
    functionName: "setBrain",
    args: [petId, processor, brainId],
    account,
  });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("setBrain failed");
  return tx;
}

/**
 * Loads a circuit straight from the chain, together with every circuit it REFs
 * (a child's brain REFs both parents'), so it can be evaluated locally.
 */
export async function loadCircuitFromChain(pub: PublicClient, processor: Address, id: bigint, depth = 0): Promise<Circuit> {
  if (depth > 4) throw new Error("circuit nests too deeply");
  const nl = await readNetlist(pub, processor, id);
  const bytes = hexToBytes(nl.bytes);
  const subs = new Map<string, Circuit>();
  for (const e of decode(bytes, nl.nIn)) {
    if (e.op !== REF) continue;
    const key = refKey(e.cpu, e.id);
    if (!subs.has(key)) subs.set(key, await loadCircuitFromChain(pub, e.cpu as Address, e.id, depth + 1));
  }
  return load(bytes, nl.nIn, nl.nOut, (cpu, sid) => subs.get(refKey(cpu, sid)) ?? null);
}

/** One beat for many inputs at once, through Multicall3 (64 per call fits X Layer's call gas cap). */
export async function replayMany(pub: PublicClient, d: Deployment, id: bigint, brainState: bigint, words: number[]): Promise<Array<{ next: bigint; outputs: number }>> {
  const res = (await pub.multicall({
    allowFailure: false,
    batchSize: 1 << 22,
    contracts: words.map((w) => ({ address: d.registry, abi: petRegistryAbi, functionName: "replayStep", args: [id, brainState, w] })),
  })) as unknown as Array<readonly [bigint, number]>;
  return res.map(([next, outputs]) => ({ next: BigInt(next), outputs: Number(outputs) }));
}
