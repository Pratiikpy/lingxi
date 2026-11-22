/**
 * The holder gift (PRD X2, plan 4.12): a free outfit for holders of TapeCode-Test1, a TapeOut Rig, BEM or FAB.
 * A wallet claims once; an NFT gives the gift only once ever. BEM and FAB holders claim from a snapshot taken at
 * a fixed block: the game loads the snapshot file, rebuilds the Merkle tree from it, and uses it only when its
 * root equals the root the gift contract holds. Reads come first, so the screen can say which way a wallet may
 * claim before anything is signed.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, parseAbi } from "viem";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { holderGiftAbi } from "./holderGiftAbi";
import type { Deployment } from "./registry";
import { RevertedOnChain } from "./receipts";

const nftAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
/** Owners read per multicall when looking for a wallet's Test1 tokens, and how many such calls run at once. */
const OWNERS_PER_CALL = 1000;
const LANES = 4;
/** Tries for a batch of owners before the lookup is reported unreadable. */
const OWNER_TRIES = 3;

/** The node could not answer the owner lookup (every read of a batch failed, however often it was asked). */
export class Test1Unreadable extends Error {}

export interface GiftTerms {
  gift: Address;
  outfit: bigint;
  test1: Address;
  rig: Address;
  snapshotRoot: Hex;
  snapshotBlock: bigint;
  bemMin: bigint;
  fabMin: bigint;
}

/** The snapshot file the snapshot script writes: wallets at or above either minimum, balances in base units. */
export interface SnapshotFile {
  block: string;
  bemMin: string;
  fabMin: string;
  root: string;
  entries: Array<[string, string, string]>;
}

export interface Snapshot {
  block: bigint;
  tree: StandardMerkleTree<[string, string, string]>;
  /** lower-cased wallet → index of its entry */
  index: Map<string, number>;
}

export type GiftWay =
  | { kind: "nft"; collection: Address; tokenId: bigint; label: "test1" | "rig" }
  | { kind: "snapshot"; bem: bigint; fab: bigint; proof: Hex[]; label: "bem" | "fab" };

export async function giftTerms(pub: PublicClient, d: Deployment): Promise<GiftTerms | null> {
  if (!d.holderGift) return null;
  const gift = { address: d.holderGift, abi: holderGiftAbi } as const;
  const [outfit, test1, rig, snapshotRoot, snapshotBlock, bemMin, fabMin] = await Promise.all([
    pub.readContract({ ...gift, functionName: "outfit" }),
    pub.readContract({ ...gift, functionName: "test1" }),
    pub.readContract({ ...gift, functionName: "rig" }),
    pub.readContract({ ...gift, functionName: "snapshotRoot" }),
    pub.readContract({ ...gift, functionName: "snapshotBlock" }),
    pub.readContract({ ...gift, functionName: "bemMin" }),
    pub.readContract({ ...gift, functionName: "fabMin" }),
  ]);
  return { gift: d.holderGift, outfit, test1, rig, snapshotRoot, snapshotBlock, bemMin, fabMin };
}

/** Rebuild the snapshot tree from its file; refuse a file whose root or block differs from the contract's. */
export function loadSnapshot(file: SnapshotFile, t: GiftTerms): Snapshot {
  const tree = StandardMerkleTree.of(
    file.entries.map((e) => [e[0].toLowerCase(), e[1], e[2]] as [string, string, string]),
    ["address", "uint256", "uint256"],
  );
  if (tree.root.toLowerCase() !== t.snapshotRoot.toLowerCase()) throw new Error("the snapshot file does not match the gift contract");
  if (BigInt(file.block) !== t.snapshotBlock) throw new Error("the snapshot file is for another block");
  const index = new Map<string, number>();
  file.entries.forEach((e, i) => index.set(e[0].toLowerCase(), i));
  return { block: BigInt(file.block), tree, index };
}

export async function giftClaimed(pub: PublicClient, t: GiftTerms, who: Address): Promise<boolean> {
  return (await pub.readContract({ address: t.gift, abi: holderGiftAbi, functionName: "claimed", args: [who] })) as boolean;
}

/** Has this NFT already given its gift? */
export async function giftTokenUsed(pub: PublicClient, t: GiftTerms, collection: Address, tokenId: bigint): Promise<boolean> {
  return (await pub.readContract({ address: t.gift, abi: holderGiftAbi, functionName: "tokenUsed", args: [collection, tokenId] })) as boolean;
}

/** This wallet's snapshot entry and proof, when it held at least one minimum at the snapshot block. */
export function snapshotWay(s: Snapshot, t: GiftTerms, who: Address): GiftWay | null {
  const i = s.index.get(who.toLowerCase());
  if (i === undefined) return null;
  const [, b, f] = s.tree.at(i)!;
  const bem = BigInt(b);
  const fab = BigInt(f);
  if (bem < t.bemMin && fab < t.fabMin) return null;
  return { kind: "snapshot", bem, fab, proof: s.tree.getProof(i) as Hex[], label: bem >= t.bemMin ? "bem" : "fab" };
}

/**
 * The Test1 tokens a wallet holds, those that have not given the gift first. The collection does not list tokens by
 * owner (it is not ERC-721 Enumerable), so every token's owner is read from the chain, a thousand to a multicall and
 * four calls at a time: its 10,000 tokens in about ten calls, a few seconds. A wallet holding none is asked nothing
 * more, and the walk stops once it has found as many tokens as the wallet holds.
 */
export interface Test1Lookup {
  /** tokens an index says the wallet holds; each is confirmed on chain, and a short list falls back to the full read */
  candidates?: readonly bigint[];
  /** owners per multicall: 1000 to a public node, fewer through a door with a smaller request limit */
  perCall?: number;
}

export async function test1TokensOf(pub: PublicClient, t: GiftTerms, who: Address, o: Test1Lookup = {}): Promise<{ unused: bigint[]; used: bigint[] }> {
  const held = Number((await pub.readContract({ address: t.test1, abi: nftAbi, functionName: "balanceOf", args: [who] })) as bigint);
  if (held === 0) return { unused: [], used: [] };
  const me = who.toLowerCase();
  let mine: bigint[] = [];
  // an index's answer is only a hint: each token is checked against the chain, and the full read runs when the hint
  // does not account for every token the wallet holds (a token bought since the index last looked)
  if (o.candidates?.length) {
    const owners = await pub.multicall({ allowFailure: true, contracts: o.candidates.map((id) => ({ address: t.test1, abi: nftAbi, functionName: "ownerOf" as const, args: [id] as const })) });
    mine = o.candidates.filter((_, k) => owners[k]!.status === "success" && String(owners[k]!.result).toLowerCase() === me);
  }
  if (mine.length < held) {
    mine = [];
    const perCall = o.perCall ?? OWNERS_PER_CALL;
    const supply = Number((await pub.readContract({ address: t.test1, abi: nftAbi, functionName: "totalSupply" })) as bigint);
    // tokens are numbered from 1; a missing one (none on mainnet) is simply skipped
    const starts = Array.from({ length: Math.ceil(supply / perCall) }, (_, k) => 1 + k * perCall);
    for (let i = 0; i < starts.length && mine.length < held; i += LANES) {
      const lanes = await Promise.all(starts.slice(i, i + LANES).map((from) => ownersFrom(pub, t, from, Math.min(perCall, supply - from + 1))));
      lanes.forEach((results, lane) =>
        results.forEach((r, k) => {
          if (r.status === "success" && String(r.result).toLowerCase() === me) mine.push(BigInt(starts[i + lane]! + k));
        }),
      );
    }
  }
  if (!mine.length) return { unused: [], used: [] };
  const usedFlags = await pub.multicall({ allowFailure: false, contracts: mine.map((id) => ({ address: t.gift, abi: holderGiftAbi, functionName: "tokenUsed" as const, args: [t.test1, id] as const })) });
  return { unused: mine.filter((_, k) => !usedFlags[k]), used: mine.filter((_, k) => usedFlags[k]) };
}

/**
 * The owners of `count` Test1 tokens from `from`, as multicall results. With failures allowed, viem marks every call of
 * a batch failed when the batch itself fails (a timeout, a rate limit), which would read as "holds nothing": such a
 * batch is asked again, and one that still fails throws, so the player is told the lookup failed rather than nothing.
 */
async function ownersFrom(pub: PublicClient, t: GiftTerms, from: number, count: number) {
  for (let attempt = 1; ; attempt++) {
    const results = await pub
      .multicall({
        allowFailure: true,
        batchSize: 1 << 20,
        contracts: Array.from({ length: count }, (_, k) => ({ address: t.test1, abi: nftAbi, functionName: "ownerOf" as const, args: [BigInt(from + k)] as const })),
      })
      .catch(() => null);
    if (results && results.some((r) => r.status === "success")) return results;
    if (attempt >= OWNER_TRIES) throw new Test1Unreadable(`the owners of TapeCode-Test1 #${from} to #${from + count - 1} could not be read`);
  }
}

/**
 * Ways this wallet can claim, each found from the chain so the player only taps: its snapshot entry first, then a Rig
 * it owns and has not used (Rigs list their tokens by owner), then a Test1 it owns and has not used (found by
 * `test1TokensOf`). The snapshot comes first because it uses up no NFT's one gift, so a wallet that qualifies by its
 * balance keeps its NFTs able to give the pin to whoever holds them next. `checkTest1` still confirms a typed number.
 */
export async function giftWays(pub: PublicClient, t: GiftTerms, who: Address, s: Snapshot | null): Promise<GiftWay[]> {
  return (await giftWaysOf(pub, t, who, s)).ways;
}

/** The ways, and whether the wallet's Test1 tokens could be looked up (when not, the player can still type a number). */
export async function giftWaysOf(pub: PublicClient, t: GiftTerms, who: Address, s: Snapshot | null, lookup: Test1Lookup = {}): Promise<{ ways: GiftWay[]; test1: "read" | "unreadable" }> {
  const ways: GiftWay[] = [];
  const snap = s ? snapshotWay(s, t, who) : null;
  if (snap) ways.push(snap);
  const rigs = (await pub.readContract({ address: t.rig, abi: nftAbi, functionName: "balanceOf", args: [who] })) as bigint;
  for (let i = 0n; i < rigs && i < 20n; i++) {
    const id = (await pub.readContract({ address: t.rig, abi: nftAbi, functionName: "tokenOfOwnerByIndex", args: [who, i] })) as bigint;
    if (!(await giftTokenUsed(pub, t, t.rig, id))) {
      ways.push({ kind: "nft", collection: t.rig, tokenId: id, label: "rig" });
      break;
    }
  }
  try {
    const test1 = await test1TokensOf(pub, t, who, lookup);
    if (test1.unused[0] !== undefined) ways.push({ kind: "nft", collection: t.test1, tokenId: test1.unused[0], label: "test1" });
  } catch (e) {
    if (!(e instanceof Test1Unreadable)) throw e;
    return { ways, test1: "unreadable" };
  }
  return { ways, test1: "read" };
}

/** Confirm a Test1 number the player typed: theirs, and not used for a gift before. */
export async function checkTest1(pub: PublicClient, t: GiftTerms, who: Address, tokenId: bigint): Promise<"ok" | "notYours" | "used" | "missing"> {
  let owner: Address;
  try {
    owner = (await pub.readContract({ address: t.test1, abi: nftAbi, functionName: "ownerOf", args: [tokenId] })) as Address;
  } catch {
    return "missing";
  }
  if (owner.toLowerCase() !== who.toLowerCase()) return "notYours";
  return (await giftTokenUsed(pub, t, t.test1, tokenId)) ? "used" : "ok";
}

export async function claimGift(pub: PublicClient, wallet: WalletClient, t: GiftTerms, way: GiftWay): Promise<Hex> {
  if (!wallet.account) throw new Error("wallet has no account");
  const at = { address: t.gift, abi: holderGiftAbi, account: wallet.account } as const;
  const tx =
    way.kind === "nft"
      ? await wallet.writeContract((await pub.simulateContract({ ...at, functionName: "claimWithNft", args: [way.collection, way.tokenId] })).request)
      : await wallet.writeContract((await pub.simulateContract({ ...at, functionName: "claimWithSnapshot", args: [way.bem, way.fab, way.proof] })).request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("claim", r.transactionHash);
  return tx;
}
