/**
 * The item shop (plan 4.6): on-chain items are item kinds on the BEM market, made only by the shop, which sells
 * them at a fixed BEM price (burned whole) or redeems a voucher our server signed for something earned in play.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, erc20Abi } from "viem";
import { itemShopAbi } from "./itemShopAbi";
import { outfitMarketV2Abi } from "./outfitMarketV2Abi";
import type { Deployment } from "./registry";
import { RevertedOnChain } from "./receipts";

export interface ShopItem {
  /** the game's piece id (a decoration) */
  piece: string;
  id: bigint;
  /** BEM base units per copy; 0 = not for sale */
  price: bigint;
  /** copies the shop can still make */
  available: bigint;
}

export interface Voucher {
  to: Address;
  id: bigint;
  quantity: number;
  nonce: bigint;
  expiresAt: bigint;
}

const acct = (w: WalletClient) => {
  if (!w.account) throw new Error("no account");
  return w.account;
};

/** The shop's items as recorded at deployment, by the game's piece id. */
export const shopItemIds = (d: Deployment): Record<string, bigint> =>
  Object.fromEntries(Object.entries(d.items ?? {}).map(([piece, id]) => [piece, BigInt(id)]));

/** Price and copies left for each recorded item. */
export async function readShopItems(pub: PublicClient, d: Deployment): Promise<ShopItem[]> {
  if (!d.itemShop) return [];
  const ids = shopItemIds(d);
  return Promise.all(
    Object.entries(ids).map(async ([piece, id]) => {
      const [price, available] = await Promise.all([
        pub.readContract({
          address: d.itemShop!,
          abi: itemShopAbi,
          functionName: "price",
          args: [id],
        }) as Promise<bigint>,
        pub.readContract({
          address: d.itemShop!,
          abi: itemShopAbi,
          functionName: "available",
          args: [id],
        }) as Promise<bigint>,
      ]);
      return { piece, id, price, available };
    }),
  );
}

/** Which recorded pieces any of these wallets holds at least one copy of. */
export async function piecesHeld(pub: PublicClient, d: Deployment, wallets: readonly Address[]): Promise<string[]> {
  const market = d.outfitMarketV2;
  const ids = Object.entries(shopItemIds(d));
  if (!market || ids.length === 0 || wallets.length === 0) return [];
  const accounts = wallets.flatMap((w) => ids.map(() => w));
  const tokenIds = wallets.flatMap(() => ids.map(([, id]) => id));
  const balances = (await pub.readContract({
    address: market,
    abi: outfitMarketV2Abi,
    functionName: "balanceOfBatch",
    args: [accounts, tokenIds],
  })) as readonly bigint[];
  const held = new Set<string>();
  balances.forEach((b, i) => {
    if (b > 0n) held.add(ids[i % ids.length]![0]);
  });
  return [...held];
}

/** Total BEM the shop has burned. */
export const shopBurned = (pub: PublicClient, d: Deployment): Promise<bigint> =>
  pub.readContract({ address: d.itemShop!, abi: itemShopAbi, functionName: "totalBurned" }) as Promise<bigint>;

/** What buying needs: BEM held, and whether an approval comes first (BEM has no permit, so a first buy takes two steps). */
export async function shopReadiness(
  pub: PublicClient,
  d: Deployment,
  who: Address,
  amount: bigint,
): Promise<{ balance: bigint; needsApproval: boolean; enough: boolean }> {
  const bem = (await pub.readContract({ address: d.itemShop!, abi: itemShopAbi, functionName: "bem" })) as Address;
  const [balance, allowance] = await Promise.all([
    pub.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>,
    pub.readContract({
      address: bem,
      abi: erc20Abi,
      functionName: "allowance",
      args: [who, d.itemShop!],
    }) as Promise<bigint>,
  ]);
  return { balance, needsApproval: allowance < amount, enough: balance >= amount };
}

/** Buy copies at the price the buyer saw: approve exactly the total if needed, then buy. Returns the purchase's hash. */
export async function buyShopItem(
  pub: PublicClient,
  wallet: WalletClient,
  d: Deployment,
  id: bigint,
  quantity: number,
  price: bigint,
): Promise<Hex> {
  const who = acct(wallet).address;
  const total = price * BigInt(quantity);
  const r = await shopReadiness(pub, d, who, total);
  if (!r.enough) throw new Error("notEnoughBem");
  if (r.needsApproval) {
    const bem = (await pub.readContract({ address: d.itemShop!, abi: itemShopAbi, functionName: "bem" })) as Address;
    const { request } = await pub.simulateContract({
      address: bem,
      abi: erc20Abi,
      functionName: "approve",
      args: [d.itemShop!, total],
      account: acct(wallet),
    });
    const a = await wallet.writeContract(request);
    if ((await pub.waitForTransactionReceipt({ hash: a })).status !== "success")
      throw new RevertedOnChain("approve", a);
  }
  const { request } = await pub.simulateContract({
    address: d.itemShop!,
    abi: itemShopAbi,
    functionName: "buy",
    args: [id, quantity, price],
    account: acct(wallet),
  });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("buy", tx);
  return tx;
}

/** Redeem a voucher the game's server signed. */
export async function claimVoucher(
  pub: PublicClient,
  wallet: WalletClient,
  d: Deployment,
  v: Voucher,
  signature: Hex,
): Promise<Hex> {
  const args = [
    { to: v.to, id: v.id, quantity: v.quantity, nonce: v.nonce, expiresAt: v.expiresAt },
    signature,
  ] as const;
  const { request } = await pub.simulateContract({
    address: d.itemShop!,
    abi: itemShopAbi,
    functionName: "claim",
    args,
    account: acct(wallet),
  });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("claim", tx);
  return tx;
}

/** Has this voucher nonce been used already. */
export const voucherUsed = (pub: PublicClient, d: Deployment, nonce: bigint): Promise<boolean> =>
  pub.readContract({
    address: d.itemShop!,
    abi: itemShopAbi,
    functionName: "usedNonce",
    args: [nonce],
  }) as Promise<boolean>;

/** The EIP-712 typed data a voucher is signed as (the server signs this; the contract checks it). */
export function voucherTypedData(d: Deployment, v: Voucher) {
  return {
    domain: { name: "Lingxi ItemShop", version: "1", chainId: d.chainId, verifyingContract: d.itemShop! },
    types: {
      Voucher: [
        { name: "to", type: "address" },
        { name: "id", type: "uint256" },
        { name: "quantity", type: "uint32" },
        { name: "nonce", type: "uint256" },
        { name: "expiresAt", type: "uint64" },
      ],
    } as const,
    primaryType: "Voucher" as const,
    message: { to: v.to, id: v.id, quantity: v.quantity, nonce: v.nonce, expiresAt: v.expiresAt },
  };
}
