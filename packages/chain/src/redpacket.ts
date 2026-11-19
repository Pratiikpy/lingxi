/**
 * Red packets on chain: fund one (approve + create), claim a share with the
 * link key's signature, reveal a lucky share two blocks later, refund after
 * expiry, and read a packet with its claims.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, erc20Abi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { redPacketAbi } from "./redPacketAbi";
import type { Deployment } from "./registry";
import { RevertedOnChain } from "./receipts";

/** USDT on X Layer (6 decimals). */
export const XLAYER_USDT: Address = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";

export interface PacketView {
  sender: Address;
  expiry: number;
  count: number;
  claimed: number;
  paid: number;
  lucky: boolean;
  petOwnersOnly: boolean;
  token: Address;
  remaining: bigint;
  floor: bigint;
  extra: bigint;
}

export interface ClaimView {
  claimer: Address;
  amount: bigint;
  index: number;
  sealInput: number;
  sealOutput: number;
  tx: Hex;
}

const need = (d: Deployment) => {
  if (!d.redPacket) throw new Error("no red packets in this deployment");
  return d.redPacket;
};
const acct = (w: WalletClient) => {
  if (!w.account) throw new Error("wallet has no account");
  return w.account;
};

export async function tokenBalance(pub: PublicClient, token: Address, who: Address): Promise<bigint> {
  return (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] })) as bigint;
}

export async function createPacket(
  pub: PublicClient,
  wallet: WalletClient,
  d: Deployment,
  o: { token: Address; total: bigint; count: number; lifetimeSec: number; key: Address; lucky: boolean; petOwnersOnly: boolean },
): Promise<{ id: bigint; tx: Hex }> {
  const rp = need(d);
  const account = acct(wallet);
  const allowance = (await pub.readContract({ address: o.token, abi: erc20Abi, functionName: "allowance", args: [account.address, rp] })) as bigint;
  if (allowance < o.total) {
    const { request } = await pub.simulateContract({ address: o.token, abi: erc20Abi, functionName: "approve", args: [rp, o.total], account });
    const atx = await wallet.writeContract(request);
    const ar = await pub.waitForTransactionReceipt({ hash: atx });
    if (ar.status !== "success") throw new RevertedOnChain("approve", ar.transactionHash);
  }
  const { request } = await pub.simulateContract({
    address: rp,
    abi: redPacketAbi,
    functionName: "create",
    args: [o.token, o.total, o.count, 0n, BigInt(o.lifetimeSec), o.key, o.lucky, o.petOwnersOnly],
    account,
  });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("create", r.transactionHash);
  const ev = parseEventLogs({ abi: redPacketAbi, logs: r.logs, eventName: "Created" })[0];
  if (!ev) throw new Error("no Created event");
  return { id: ev.args.id, tx };
}

/** The link key signs the claimer's address; the signature is useless to anyone else. */
export async function signClaim(pub: PublicClient, d: Deployment, keyPk: Hex, id: bigint, claimer: Address): Promise<Hex> {
  const digest = (await pub.readContract({ address: need(d), abi: redPacketAbi, functionName: "claimDigest", args: [id, claimer] })) as Hex;
  // claimDigest is already the eth-signed-message hash; sign it raw
  return privateKeyToAccount(keyPk).sign({ hash: digest });
}

/** Claim a share; `petId` is the claimer's settled pet for a pet-owners-only packet (0 otherwise). */
/** The claim a transaction made, read from its own receipt: no log query, so no node's range limit applies. */
function claimIn(logs: Parameters<typeof parseEventLogs>[0]["logs"], tx: Hex): ClaimView | null {
  const paid = parseEventLogs({ abi: redPacketAbi, logs, eventName: "Claimed" })[0];
  if (!paid) return null;
  return { claimer: paid.args.claimer, amount: paid.args.amount, index: Number(paid.args.index), sealInput: Number(paid.args.sealInput), sealOutput: Number(paid.args.sealOutput), tx };
}

export async function claimPacket(pub: PublicClient, wallet: WalletClient, d: Deployment, id: bigint, sig: Hex, petId = 0n): Promise<{ amount: bigint; reserved: boolean; tx: Hex; block: bigint; claim: ClaimView | null }> {
  const account = acct(wallet);
  const { request } = await pub.simulateContract({ address: need(d), abi: redPacketAbi, functionName: "claim", args: [id, sig, petId], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("claim", r.transactionHash);
  const claim = claimIn(r.logs, tx);
  return { amount: claim?.amount ?? 0n, reserved: !claim, tx, block: r.blockNumber, claim };
}

export async function revealPacket(pub: PublicClient, wallet: WalletClient, d: Deployment, id: bigint): Promise<{ amount: bigint; tx: Hex; claim: ClaimView | null }> {
  const account = acct(wallet);
  const { request } = await pub.simulateContract({ address: need(d), abi: redPacketAbi, functionName: "reveal", args: [id], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("reveal", r.transactionHash);
  const claim = claimIn(r.logs, tx);
  return { amount: claim?.amount ?? 0n, tx, claim };
}

export async function refundPacket(pub: PublicClient, wallet: WalletClient, d: Deployment, id: bigint): Promise<Hex> {
  const account = acct(wallet);
  const { request } = await pub.simulateContract({ address: need(d), abi: redPacketAbi, functionName: "refund", args: [id], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("refund", r.transactionHash);
  return tx;
}

export async function readPacket(pub: PublicClient, d: Deployment, id: bigint): Promise<PacketView> {
  const p = await pub.readContract({ address: need(d), abi: redPacketAbi, functionName: "packet", args: [id] });
  return { ...p, expiry: Number(p.expiry), count: Number(p.count), claimed: Number(p.claimed), paid: Number(p.paid) };
}

export async function pendingOf(pub: PublicClient, d: Deployment, id: bigint, who: Address): Promise<{ atBlock: bigint; index: number } | null> {
  const [atBlock, index] = (await pub.readContract({ address: need(d), abi: redPacketAbi, functionName: "pending", args: [id, who] })) as readonly [bigint, number, boolean];
  return atBlock === 0n ? null : { atBlock, index: Number(index) };
}

/** A top-up owed to `who` once every share of a lucky packet is open (0 if none). */
export async function owedOf(pub: PublicClient, d: Deployment, id: bigint, who: Address): Promise<bigint> {
  return (await pub.readContract({ address: need(d), abi: redPacketAbi, functionName: "owed", args: [id, who] })) as bigint;
}

export async function collectPacket(pub: PublicClient, wallet: WalletClient, d: Deployment, id: bigint): Promise<{ amount: bigint; tx: Hex }> {
  const account = acct(wallet);
  const { request, result } = await pub.simulateContract({ address: need(d), abi: redPacketAbi, functionName: "collect", args: [id], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new RevertedOnChain("collect", r.transactionHash);
  return { amount: result as bigint, tx };
}
