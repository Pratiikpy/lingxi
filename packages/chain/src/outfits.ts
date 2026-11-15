/**
 * The fashion market (PRD S3, M4) from the game's side: publish a design, buy
 * copies from its creator, list copies for resale, buy a listing, and collect
 * proceeds. Every write is simulated first, and every result is read back from
 * the transaction's own events.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, parseEventLogs } from "viem";
import { outfitMarketAbi } from "./outfitMarketAbi";
import type { Deployment } from "./registry";

export interface OutfitDesign {
  id: bigint;
  creator: Address;
  price: bigint;
  maxSupply: number;
  minted: number;
  royaltyBps: number;
  closed: boolean;
  name: string;
  pixels: Hex;
}

export interface OutfitListing {
  id: bigint;
  seller: Address;
  design: bigint;
  quantity: number;
  priceEach: bigint;
}

const need = (d: Deployment): Address => {
  if (!d.outfitMarket) throw new Error("no fashion market in this deployment");
  return d.outfitMarket;
};
const acct = (w: WalletClient) => {
  if (!w.account) throw new Error("wallet has no account");
  return w.account;
};

async function send(pub: PublicClient, wallet: WalletClient, d: Deployment, functionName: string, args: readonly unknown[], value = 0n) {
  const { request } = await pub.simulateContract({ address: need(d), abi: outfitMarketAbi, functionName: functionName as never, args: args as never, value, account: acct(wallet) } as never);
  const tx = await wallet.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${functionName} failed`);
  return { tx, logs: r.logs };
}

export async function publishDesign(pub: PublicClient, wallet: WalletClient, d: Deployment, o: { pixels: Uint8Array; name: string; price: bigint; maxSupply: number; royaltyBps: number }): Promise<{ id: bigint; tx: Hex }> {
  const hex = `0x${Array.from(o.pixels, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  const { tx, logs } = await send(pub, wallet, d, "create", [hex, o.name, o.price, o.maxSupply, o.royaltyBps]);
  const ev = parseEventLogs({ abi: outfitMarketAbi, logs, eventName: "Created" })[0];
  if (!ev) throw new Error("no Created event");
  return { id: ev.args.id, tx };
}

export async function buyDesign(pub: PublicClient, wallet: WalletClient, d: Deployment, id: bigint, quantity: number, price: bigint): Promise<Hex> {
  return (await send(pub, wallet, d, "mint", [id, quantity, price], price * BigInt(quantity))).tx;
}

export async function listCopies(pub: PublicClient, wallet: WalletClient, d: Deployment, id: bigint, quantity: number, priceEach: bigint): Promise<{ listingId: bigint; tx: Hex }> {
  const { tx, logs } = await send(pub, wallet, d, "list", [id, quantity, priceEach]);
  const ev = parseEventLogs({ abi: outfitMarketAbi, logs, eventName: "Listed" })[0];
  if (!ev) throw new Error("no Listed event");
  return { listingId: ev.args.listingId, tx };
}

export async function buyListing(pub: PublicClient, wallet: WalletClient, d: Deployment, listingId: bigint, quantity: number, priceEach: bigint): Promise<Hex> {
  return (await send(pub, wallet, d, "buy", [listingId, quantity, priceEach], priceEach * BigInt(quantity))).tx;
}

export async function cancelListing(pub: PublicClient, wallet: WalletClient, d: Deployment, listingId: bigint): Promise<Hex> {
  return (await send(pub, wallet, d, "cancel", [listingId])).tx;
}

export async function withdrawProceeds(pub: PublicClient, wallet: WalletClient, d: Deployment): Promise<Hex> {
  return (await send(pub, wallet, d, "withdraw", [])).tx;
}

export async function readDesign(pub: PublicClient, d: Deployment, id: bigint): Promise<OutfitDesign> {
  const r = (await pub.readContract({ address: need(d), abi: outfitMarketAbi, functionName: "design", args: [id] })) as Omit<OutfitDesign, "id">;
  return { id, creator: r.creator, price: r.price, maxSupply: Number(r.maxSupply), minted: Number(r.minted), royaltyBps: Number(r.royaltyBps), closed: r.closed, name: r.name, pixels: r.pixels };
}

/** Every design, newest first (up to `limit`). */
export async function readDesigns(pub: PublicClient, d: Deployment, limit = 200): Promise<OutfitDesign[]> {
  const next = (await pub.readContract({ address: need(d), abi: outfitMarketAbi, functionName: "nextDesign" })) as bigint;
  const ids: bigint[] = [];
  for (let i = next - 1n; i >= 1n && ids.length < limit; i--) ids.push(i);
  return Promise.all(ids.map((id) => readDesign(pub, d, id)));
}

/** Open listings that can still be bought: the seller still holds the copies and the listing was not retired. */
export async function readListings(pub: PublicClient, d: Deployment, limit = 300): Promise<OutfitListing[]> {
  const m = need(d);
  const next = (await pub.readContract({ address: m, abi: outfitMarketAbi, functionName: "nextListing" })) as bigint;
  const out: OutfitListing[] = [];
  for (let i = next - 1n; i >= 1n && next - i <= BigInt(limit); i--) {
    const [seller, design, quantity, priceEach, nonce] = (await pub.readContract({ address: m, abi: outfitMarketAbi, functionName: "listings", args: [i] })) as readonly [Address, bigint, number, bigint, number];
    if (seller === "0x0000000000000000000000000000000000000000") continue;
    const [live, held] = await Promise.all([
      pub.readContract({ address: m, abi: outfitMarketAbi, functionName: "listNonce", args: [seller, design] }) as Promise<number>,
      pub.readContract({ address: m, abi: outfitMarketAbi, functionName: "balanceOf", args: [seller, design] }) as Promise<bigint>,
    ]);
    if (Number(live) !== Number(nonce) || held < BigInt(quantity)) continue;
    out.push({ id: i, seller, design, quantity: Number(quantity), priceEach });
  }
  return out;
}

export async function copiesHeld(pub: PublicClient, d: Deployment, who: Address, ids: readonly bigint[]): Promise<bigint[]> {
  if (!ids.length) return [];
  return (await pub.readContract({ address: need(d), abi: outfitMarketAbi, functionName: "balanceOfBatch", args: [ids.map(() => who), [...ids]] })) as bigint[];
}

export async function proceedsOwed(pub: PublicClient, d: Deployment, who: Address): Promise<bigint> {
  return (await pub.readContract({ address: need(d), abi: outfitMarketAbi, functionName: "owed", args: [who] })) as bigint;
}

export async function marketFeeBps(pub: PublicClient, d: Deployment): Promise<number> {
  return Number(await pub.readContract({ address: need(d), abi: outfitMarketAbi, functionName: "feeBps" }));
}
