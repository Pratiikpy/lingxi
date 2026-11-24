/**
 * The paid extras (plan 4.9): room space and saved-look packs per wallet, and a name colour per pet, each at a fixed
 * BEM price that the Extras contract burns whole in the same transaction.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, erc20Abi } from "viem";
import { extrasAbi } from "./extrasAbi";
import type { Deployment } from "./registry";
import { RevertedOnChain } from "./receipts";

export const EXTRA = { room: 0, looks: 1, colour: 2 } as const;
export type ExtraKind = keyof typeof EXTRA;

export interface ExtrasTerms {
  /** room packs and look packs this wallet holds (0..3 each) */
  room: number;
  looks: number;
  /** BEM base units per purchase; 0 = off sale */
  price: Record<ExtraKind, bigint>;
  /** name colours on offer, 1..colours */
  colours: number;
}

const acct = (w: WalletClient) => {
  if (!w.account) throw new Error("no account");
  return w.account;
};

/** One wallet's packs, the prices and the colours on offer, in one call. */
export async function readExtras(pub: PublicClient, d: Deployment, who: Address): Promise<ExtrasTerms> {
  const [room, looks, roomPrice, lookPrice, colourPrice, colours] = (await pub.readContract({
    address: d.extras!,
    abi: extrasAbi,
    functionName: "extrasOf",
    args: [who],
  })) as readonly [number, number, bigint, bigint, bigint, number];
  return {
    room: Number(room),
    looks: Number(looks),
    price: { room: roomPrice, looks: lookPrice, colour: colourPrice },
    colours: Number(colours),
  };
}

/**
 * The most packs any of these wallets holds, per kind (a player's extras are the best their wallets have; packs
 * never add up across wallets, as each wallet may hold at most three).
 */
export async function packsHeld(
  pub: PublicClient,
  d: Deployment,
  wallets: readonly Address[],
): Promise<{ room: number; looks: number }> {
  if (!d.extras || wallets.length === 0) return { room: 0, looks: 0 };
  const all = await Promise.all(wallets.map((w) => readExtras(pub, d, w)));
  return { room: Math.max(0, ...all.map((x) => x.room)), looks: Math.max(0, ...all.map((x) => x.looks)) };
}

/** The name colour of each pet (0 = plain), in one call. */
export async function nameColours(
  pub: PublicClient,
  d: Deployment,
  petIds: readonly bigint[],
): Promise<Record<string, number>> {
  if (!d.extras || petIds.length === 0) return {};
  const got = (await pub.readContract({
    address: d.extras,
    abi: extrasAbi,
    functionName: "coloursOf",
    args: [petIds],
  })) as readonly number[];
  return Object.fromEntries(petIds.map((id, i) => [id.toString(), Number(got[i] ?? 0)]));
}

/** What the contract has burned: each extra's takings, stray BEM, the total, and purchases per extra. */
export async function extrasBurned(
  pub: PublicClient,
  d: Deployment,
): Promise<{
  room: bigint;
  looks: bigint;
  colour: bigint;
  stray: bigint;
  total: bigint;
  sold: Record<ExtraKind, bigint>;
}> {
  const read = (functionName: "spentOn" | "sold", f: number) =>
    pub.readContract({ address: d.extras!, abi: extrasAbi, functionName, args: [f] }) as Promise<bigint>;
  const [room, looks, colour, sRoom, sLooks, sColour, stray, total] = await Promise.all([
    read("spentOn", EXTRA.room),
    read("spentOn", EXTRA.looks),
    read("spentOn", EXTRA.colour),
    read("sold", EXTRA.room),
    read("sold", EXTRA.looks),
    read("sold", EXTRA.colour),
    pub.readContract({ address: d.extras!, abi: extrasAbi, functionName: "strayBurned" }) as Promise<bigint>,
    pub.readContract({ address: d.extras!, abi: extrasAbi, functionName: "totalBurned" }) as Promise<bigint>,
  ]);
  return { room, looks, colour, stray, total, sold: { room: sRoom, looks: sLooks, colour: sColour } };
}

/** BEM held, and whether an approval of exactly this amount must come first. */
export async function extrasReadiness(
  pub: PublicClient,
  d: Deployment,
  who: Address,
  amount: bigint,
): Promise<{ balance: bigint; needsApproval: boolean; enough: boolean }> {
  const bem = (await pub.readContract({ address: d.extras!, abi: extrasAbi, functionName: "bem" })) as Address;
  const [balance, allowance] = await Promise.all([
    pub.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>,
    pub.readContract({
      address: bem,
      abi: erc20Abi,
      functionName: "allowance",
      args: [who, d.extras!],
    }) as Promise<bigint>,
  ]);
  return { balance, needsApproval: allowance < amount, enough: balance >= amount };
}

async function approveIfNeeded(pub: PublicClient, wallet: WalletClient, d: Deployment, amount: bigint): Promise<void> {
  const r = await extrasReadiness(pub, d, acct(wallet).address, amount);
  if (!r.enough) throw new Error("notEnoughBem");
  if (!r.needsApproval) return;
  const bem = (await pub.readContract({ address: d.extras!, abi: extrasAbi, functionName: "bem" })) as Address;
  const { request } = await pub.simulateContract({
    address: bem,
    abi: erc20Abi,
    functionName: "approve",
    args: [d.extras!, amount],
    account: acct(wallet),
  });
  const a = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: a })).status !== "success") throw new RevertedOnChain("approve", a);
}

/** Buy a room or look pack at the price the player saw. Returns the purchase's hash. */
export async function buyPack(
  pub: PublicClient,
  wallet: WalletClient,
  d: Deployment,
  kind: "room" | "looks",
  price: bigint,
): Promise<Hex> {
  await approveIfNeeded(pub, wallet, d, price);
  const { request } = await pub.simulateContract({
    address: d.extras!,
    abi: extrasAbi,
    functionName: kind === "room" ? "buyRoom" : "buyLooks",
    args: [price],
    account: acct(wallet),
  });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success")
    throw new RevertedOnChain("purchase", tx);
  return tx;
}

/** Give a pet's name a colour (1..colours) at the price the player saw, or take it back to plain (0, free). */
export async function colourName(
  pub: PublicClient,
  wallet: WalletClient,
  d: Deployment,
  petId: bigint,
  colour: number,
  price: bigint,
): Promise<Hex> {
  if (colour !== 0) await approveIfNeeded(pub, wallet, d, price);
  const { request } = await pub.simulateContract({
    address: d.extras!,
    abi: extrasAbi,
    functionName: "setNameColour",
    args: [petId, colour, colour === 0 ? 0n : price],
    account: acct(wallet),
  });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("colour", tx);
  return tx;
}
