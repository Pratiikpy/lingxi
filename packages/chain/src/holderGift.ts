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
]);

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
 * Ways this wallet can claim: a Rig it owns and has not used (Rigs list their tokens by owner), then its
 * snapshot entry. A Test1 token cannot be found this way (the collection does not list tokens by owner), so
 * the player names its number and `checkTest1` confirms it.
 */
export async function giftWays(pub: PublicClient, t: GiftTerms, who: Address, s: Snapshot | null): Promise<GiftWay[]> {
  const ways: GiftWay[] = [];
  const rigs = (await pub.readContract({ address: t.rig, abi: nftAbi, functionName: "balanceOf", args: [who] })) as bigint;
  for (let i = 0n; i < rigs && i < 20n; i++) {
    const id = (await pub.readContract({ address: t.rig, abi: nftAbi, functionName: "tokenOfOwnerByIndex", args: [who, i] })) as bigint;
    if (!(await giftTokenUsed(pub, t, t.rig, id))) {
      ways.push({ kind: "nft", collection: t.rig, tokenId: id, label: "rig" });
      break;
    }
  }
  const snap = s ? snapshotWay(s, t, who) : null;
  if (snap) ways.push(snap);
  return ways;
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
