/**
 * Reading and writing Lingxi pets on chain. Reads need no wallet; writes take
 * any viem wallet client (an injected wallet, Privy, or a local key in tests).
 */

import { WaitForTransactionReceiptTimeoutError, keccak256, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { LOOK_LINES } from "./look";
import { petLookAbi } from "./lookAbi";
import { hatchedPetIdFrom, RevertedOnChain } from "./receipts";
import { petRegistryAbi } from "./registryAbi";
import { processorAbi } from "./tapeout";
import { type Circuit, REF, decode, hexToBytes, load, refKey } from "@lingxi/brain";
import { MAX_RUN_GATES } from "@lingxi/game";

export interface Deployment {
  /** the block PetRegistry was deployed at, where an index of its events starts */
  registryBlock?: number;
  /** the Breeder contract, when families are deployed */
  breeder?: Address;
  /** the first breeder (free, before the BEM fee); its children stay on record */
  breederFree?: Address;
  /** true when `breeder` is BreederV2: a BEM fee (burned), a fee cap argument, at most 4 children per pet */
  breederBem?: boolean;
  /** red packet escrow and its seal circuit id, when deployed */
  redPacket?: Address;
  /** the first fashion market, paid in OKB (OutfitMarket); kept for designs sold there */
  outfitMarket?: Address;
  /** the block the first market was deployed at */
  outfitMarketBlock?: number;
  /** the fashion market paid in BEM, fees burned (OutfitMarketV2), and the block it was deployed at */
  outfitMarketV2?: Address;
  outfitMarketV2Block?: number;
  /** the holder gift contract and the outfit it gives (a design on the BEM market) */
  holderGift?: Address;
  holderOutfit?: number;
  /** the adoption centre (plan 4.8) and the block it was deployed at */
  adoptionCentre?: Address;
  adoptionCentreBlock?: number;
  /** the item shop (plan 4.6): sells on-chain items for burned BEM and redeems the game's vouchers */
  itemShop?: Address;
  itemShopBlock?: number;
  /** its items: the game's piece id to the item kind's id on the BEM market */
  items?: Record<string, string>;
  /** the paid extras (plan 4.9): room space, saved looks and name colours, every price burned */
  extras?: Address;
  extrasBlock?: number;
  /** the address whose signatures the shop accepts on vouchers */
  voucherSigner?: Address;
  seal?: string;
  /** the on-chain picture and names contract (PetLook), when deployed */
  look?: Address;
  /** block the escrow was deployed at, to read its events from */
  redPacketBlock?: number;
  chainId: number;
  rpc: string;
  processor: Address;
  /** the processor's number in TapeOut's factory (names its DeWEB sites); checked on use */
  processorIndex?: number;
  registry: Address;
  circuits: Record<string, { id: string; tx: string; gates: number }>;
  /** the game's rules taped out as circuits on the same processor (plan 4.11), by rule name */
  rules?: Record<string, { id: string; tx: string; gates: number }>;
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
  const [x, owner] = await Promise.all([
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "pet", args: [id] }),
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "ownerOf", args: [id] }),
  ]);
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

/** A line by name, in the registry's order: its index is the line the registry records. */
export type Line = (typeof LOOK_LINES)[number];

/** The line a state word carries (bits 152-153, as the game packs it; 3 is no line). */
export const lineOfState = (state: bigint): number => Number((state >> 152n) & 3n);

/**
 * A write refused before any wallet prompt because the state is another line's pet (A18): a hatch whose starting
 * state is not its line's, or a day's save over a pet of another line, which no later save could undo.
 */
export class LineMismatchError extends Error {
  constructor(
    readonly line: string,
    readonly stateLine: string,
  ) {
    super(`this state is a ${stateLine} pet's, not a ${line} pet's: not written`);
    this.name = "LineMismatchError";
  }
}

const lineName = (i: number) => LOOK_LINES[i] ?? `line ${i}`;

/** How long a hatch waits for X Layer to confirm it before the game says it is still waiting (A30). */
export const RECEIPT_TIMEOUT_MS = 120_000;

/** A write sent but not confirmed in time (A30): it may still land, so the game must not send it again. */
export class StillPending extends Error {
  constructor(
    readonly what: string,
    readonly tx: Hex,
  ) {
    super(`${what} sent, not yet confirmed`);
    this.name = "StillPending";
  }
}

/**
 * What became of a hatch sent earlier (A30): its pet once mined, "failed" if X Layer turned it down, "pending" while
 * the node knows the transaction but has not mined it, "unknown" when the node knows nothing of it (not yet seen, or
 * dropped).
 */
export async function hatchOutcome(pub: PublicClient, d: Deployment, tx: Hex, owner: Address): Promise<{ petId: bigint } | "failed" | "pending" | "unknown"> {
  const r = await pub.getTransactionReceipt({ hash: tx }).catch(() => null);
  if (!r) return (await pub.getTransaction({ hash: tx }).catch(() => null)) ? "pending" : "unknown";
  if (r.status !== "success") return "failed";
  return { petId: hatchedPetIdFrom(r, d.registry, owner) };
}

/**
 * Hatches a pet of `line` with its starting state. The registry's line index is derived here from the name, and a
 * state of another line is refused: mainnet pet #2 was hatched with index 0 and a bold state by a script that passed
 * the two separately (A18).
 */
export async function hatchOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, line: Line, initialState: bigint, onSent?: (tx: Hex) => void): Promise<{ petId: bigint; tx: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const index = LOOK_LINES.indexOf(line);
  if (index < 0) throw new Error(`unknown line ${line}`);
  if (lineOfState(initialState) !== index) throw new LineMismatchError(line, lineName(lineOfState(initialState)));
  const brainId = BigInt(d.circuits[line]!.id);
  const { request } = await pub.simulateContract({
    address: d.registry,
    abi: petRegistryAbi,
    functionName: "hatch",
    args: [account.address, index, d.processor, brainId, initialState],
    account,
  });
  const tx = await wallet.writeContract(request);
  // remembered before the wait, so a hatch that is slow to confirm is never sent twice (A30)
  onSent?.(tx);
  let r;
  try {
    r = await pub.waitForTransactionReceipt({ hash: tx, timeout: RECEIPT_TIMEOUT_MS });
  } catch (e) {
    if (e instanceof WaitForTransactionReceiptTimeoutError) throw new StillPending("hatch", tx);
    throw e;
  }
  if (r.status !== "success") throw new RevertedOnChain("hatch", r.transactionHash);
  // the id from the mined Hatched event: someone else's hatch between the simulation and the block takes the simulated one
  return { petId: hatchedPetIdFrom(r, d.registry, account.address), tx };
}

/** Saves a day: refused, before any wallet prompt, when the state is not of the pet's recorded line (A18). */
export async function checkpointOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, day: number, state: bigint, logHash: Hex): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const recorded = (await pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "pet", args: [petId] })) as { line: number };
  if (lineOfState(state) !== Number(recorded.line)) throw new LineMismatchError(lineName(Number(recorded.line)), lineName(lineOfState(state)));
  const { request } = await pub.simulateContract({
    address: d.registry,
    abi: petRegistryAbi,
    functionName: "checkpoint",
    args: [petId, day, state, logHash],
    account,
  });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("checkpoint", r.transactionHash);
  return tx;
}

/** Let `who` keep the pet (write checkpoints) until `until` (seconds); owner only, at most 30 days. */
export async function setSitterOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, who: Address, until: bigint): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({ address: d.registry, abi: petRegistryAbi, functionName: "setSitter", args: [petId, who, until], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("setSitter", r.transactionHash);
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
  if (r.status !== "success") throw new RevertedOnChain("setBrain", r.transactionHash);
  return tx;
}

/** A brain that would run more gates each beat than an honest pet's whole mind can (A38). */
export class BrainTooBigError extends Error {
  constructor(
    readonly gates: number,
    readonly max: number,
  ) {
    super(`this brain runs ${gates} gates a beat, past the ${max} any pet's mind can`);
    this.name = "BrainTooBigError";
  }
}

/**
 * Loads a circuit straight from the chain, together with every circuit it REFs
 * (a child's brain REFs both parents'), so it can be evaluated locally. Each
 * distinct circuit is read once however many paths lead to it, and a brain that
 * would run more than `maxGates` gates a beat is refused before anyone runs it
 * (A38): any pet can be pointed at any circuit on the processor.
 */
export async function loadCircuitFromChain(pub: PublicClient, processor: Address, id: bigint, maxGates = MAX_RUN_GATES): Promise<Circuit> {
  const loading = new Map<string, Promise<Circuit>>();
  const one = (cpu: Address, cid: bigint, depth: number): Promise<Circuit> => {
    const key = refKey(cpu, cid);
    const known = loading.get(key);
    if (known) return known;
    const p = (async () => {
      if (depth > 4) throw new Error("circuit nests too deeply");
      const nl = await readNetlist(pub, cpu, cid);
      const bytes = hexToBytes(nl.bytes);
      const subs = new Map<string, Circuit>();
      for (const e of decode(bytes, nl.nIn)) {
        if (e.op !== REF) continue;
        const k = refKey(e.cpu, e.id);
        if (!subs.has(k)) subs.set(k, await one(e.cpu as Address, e.id, depth + 1));
      }
      const c = load(bytes, nl.nIn, nl.nOut, (rc, sid) => subs.get(refKey(rc, sid)) ?? null);
      if (c.nGates > maxGates) throw new BrainTooBigError(c.nGates, maxGates);
      return c;
    })();
    loading.set(key, p);
    return p;
  };
  return one(processor, id, 0);
}

/** One beat for many inputs at once, through Multicall3 (64 per call fits X Layer's call gas cap). */
export async function replayMany(pub: PublicClient, d: Deployment, id: bigint, brainState: bigint, words: number[]): Promise<Array<{ next: bigint; outputs: number }>> {
  const res = (await pub.multicall({
    allowFailure: false,
    batchSize: 1 << 22,
    contracts: words.map((w) => ({ address: d.registry, abi: petRegistryAbi, functionName: "replayStep" as const, args: [id, brainState, w] as const })),
  }));
  return res.map(([next, outputs]) => ({ next: BigInt(next), outputs: Number(outputs) }));
}

/** The pet's name on chain ("" if none) and which pet, if any, holds a given name (case-insensitive for ASCII). */
export async function readName(pub: PublicClient, d: Deployment, petId: bigint): Promise<string> {
  if (!d.look) return "";
  return (await pub.readContract({ address: d.look, abi: petLookAbi, functionName: "nameOf", args: [petId] })) as string;
}

export async function nameHolderOf(pub: PublicClient, d: Deployment, name: string): Promise<bigint | null> {
  if (!d.look) return null;
  const low = new TextEncoder().encode(name).map((c) => (c >= 0x41 && c <= 0x5a ? c + 32 : c));
  const h = (await pub.readContract({ address: d.look, abi: petLookAbi, functionName: "nameHolder", args: [keccak256(low)] })) as bigint;
  return h === 0n ? null : h - 1n;
}

export async function setNameOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, name: string): Promise<Hex> {
  if (!d.look) throw new Error("names are not deployed");
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({ address: d.look, abi: petLookAbi, functionName: "setName", args: [petId, name], account });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("setName", tx);
  return tx;
}

/** The pet's ERC-721 metadata as the registry serves it (the picture is drawn on chain once PetLook is the renderer). */
export async function readMetadata(pub: PublicClient, d: Deployment, petId: bigint): Promise<{ name: string; image?: string; attributes?: Array<{ trait_type: string; value: unknown }> }> {
  const uri = (await pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "tokenURI", args: [petId] })) as string;
  const b64 = uri.slice(uri.indexOf(",") + 1);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}
