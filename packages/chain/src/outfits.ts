/**
 * The fashion market (PRD S3, M4) from the game's side: publish a design, buy
 * copies from its creator, list copies for resale, buy a listing, and collect
 * proceeds. Every write is simulated first, and every result is read back from
 * the transaction's own events.
 *
 * Two markets exist. The first (version 1) is paid in OKB and holds the designs
 * sold before BEM pricing; it stays readable and usable. The second (version 2)
 * is paid in BEM: the buyer approves the market for the exact amount, the market
 * pulls it, and the whole fee is burned in the same transaction.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, erc20Abi, parseEventLogs } from "viem";
import { outfitMarketAbi } from "./outfitMarketAbi";
import { outfitMarketV2Abi } from "./outfitMarketV2Abi";
import type { Deployment } from "./registry";

export type MarketVersion = 1 | 2;

export interface Market {
  v: MarketVersion;
  address: Address;
}

export interface OutfitDesign {
  market: MarketVersion;
  id: bigint;
  creator: Address;
  /** price per copy: wei of OKB on market 1, base units of BEM (8 decimals) on market 2 */
  price: bigint;
  maxSupply: number;
  minted: number;
  royaltyBps: number;
  closed: boolean;
  /** an item kind made by the game (market 2): no pixels, not drawn */
  item: boolean;
  name: string;
  pixels: Hex;
}

export interface OutfitListing {
  market: MarketVersion;
  id: bigint;
  seller: Address;
  design: bigint;
  quantity: number;
  priceEach: bigint;
  /** unix seconds; market 1 listings never expire */
  expiresAt: number | null;
  /** the only wallet that may buy, when the seller named one */
  buyer: Address | null;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const DAY = 86_400;

/** The markets a deployment has, newest first. */
export function marketsOf(d: Deployment): Market[] {
  const out: Market[] = [];
  if (d.outfitMarketV2) out.push({ v: 2, address: d.outfitMarketV2 });
  if (d.outfitMarket) out.push({ v: 1, address: d.outfitMarket });
  return out;
}

/** The market new designs go to: BEM when it exists. */
export function currentMarket(d: Deployment): Market | null {
  return marketsOf(d)[0] ?? null;
}

/** The wearable id of a market design; market 1 keeps its original "c:" ids so saved outfits still match. */
export const wearKey = (v: MarketVersion, id: bigint | string): string => (v === 1 ? `c:${id}` : `c2:${id}`);

/** Reads a wearable id back: which market and which design, or null for anything else. */
export function parseWearKey(key: string): { v: MarketVersion; id: bigint } | null {
  const m = /^c(2?):(\d+)$/.exec(key);
  return m ? { v: m[1] ? 2 : 1, id: BigInt(m[2]!) } : null;
}

const abiOf = (m: Market) => (m.v === 2 ? outfitMarketV2Abi : outfitMarketAbi);
const acct = (w: WalletClient) => {
  if (!w.account) throw new Error("wallet has no account");
  return w.account;
};

/** Sends one write (`write` simulates it first, against its own market's ABI) and waits for it to be mined. */
async function confirmed(pub: PublicClient, functionName: string, write: () => Promise<Hex>) {
  const tx = await write();
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${functionName} failed`);
  return { tx, logs: r.logs };
}

const bemCache = new Map<string, Address>();

/** The BEM token a version-2 market is paid in, read from the market itself. */
export async function marketBem(pub: PublicClient, m: Market): Promise<Address> {
  if (m.v !== 2) throw new Error("market 1 is paid in OKB");
  const hit = bemCache.get(m.address);
  if (hit) return hit;
  const a = (await pub.readContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "bem" })) as Address;
  bemCache.set(m.address, a);
  return a;
}

/** What a payment needs from the wallet: the BEM held, and whether an approval comes first. */
export async function bemReadiness(pub: PublicClient, m: Market, who: Address, amount: bigint): Promise<{ balance: bigint; allowance: bigint; needsApproval: boolean; enough: boolean }> {
  const bem = await marketBem(pub, m);
  const [balance, allowance] = await Promise.all([
    pub.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>,
    pub.readContract({ address: bem, abi: erc20Abi, functionName: "allowance", args: [who, m.address] }) as Promise<bigint>,
  ]);
  return { balance, allowance, needsApproval: allowance < amount, enough: balance >= amount };
}

/** Approve the market for exactly `amount` when the current allowance is short. Returns the approval's hash, or null. */
export async function approveBem(pub: PublicClient, wallet: WalletClient, m: Market, amount: bigint): Promise<Hex | null> {
  const who = acct(wallet).address;
  const r = await bemReadiness(pub, m, who, amount);
  if (!r.enough) throw new Error("not enough BEM");
  if (!r.needsApproval) return null;
  const bem = await marketBem(pub, m);
  const { request } = await pub.simulateContract({ address: bem, abi: erc20Abi, functionName: "approve", args: [m.address, amount], account: acct(wallet) });
  const tx = await wallet.writeContract(request);
  const rc = await pub.waitForTransactionReceipt({ hash: tx });
  if (rc.status !== "success") throw new Error("approve failed");
  return tx;
}

export async function publishDesign(pub: PublicClient, wallet: WalletClient, m: Market, o: { pixels: Uint8Array; name: string; price: bigint; maxSupply: number; royaltyBps: number }): Promise<{ id: bigint; tx: Hex }> {
  const hex = `0x${Array.from(o.pixels, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  const account = acct(wallet);
  const args = [hex, o.name, o.price, o.maxSupply, o.royaltyBps] as const;
  const { tx, logs } = await confirmed(pub, "create", async () =>
    m.v === 2
      ? wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "create", args, account })).request)
      : wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketAbi, functionName: "create", args, account })).request),
  );
  const ev = (m.v === 2 ? parseEventLogs({ abi: outfitMarketV2Abi, logs, eventName: "Created" }) : parseEventLogs({ abi: outfitMarketAbi, logs, eventName: "Created" }))[0];
  if (!ev) throw new Error("no Created event");
  return { id: ev.args.id, tx };
}

/** Buy copies from the creator. On market 2 the BEM is approved first when needed. */
export async function buyDesign(pub: PublicClient, wallet: WalletClient, m: Market, id: bigint, quantity: number, price: bigint): Promise<Hex> {
  const total = price * BigInt(quantity);
  const args = [id, quantity, price] as const;
  if (m.v === 2) {
    await approveBem(pub, wallet, m, total);
    return (await confirmed(pub, "mint", async () => wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "mint", args, account: acct(wallet) })).request))).tx;
  }
  return (await confirmed(pub, "mint", async () => wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketAbi, functionName: "mint", args, value: total, account: acct(wallet) })).request))).tx;
}

/** List copies for resale. Market 2 listings last `days` (1 to 180) and may name one buyer. */
export async function listCopies(pub: PublicClient, wallet: WalletClient, m: Market, id: bigint, quantity: number, priceEach: bigint, opts: { days?: number; buyer?: Address } = {}): Promise<{ listingId: bigint; tx: Hex }> {
  const account = acct(wallet);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Math.min(180, Math.max(1, opts.days ?? 30)) * DAY);
  const { tx, logs } = await confirmed(pub, "list", async () =>
    m.v === 2
      ? wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "list", args: [id, quantity, priceEach, expiresAt, opts.buyer ?? ZERO], account })).request)
      : wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketAbi, functionName: "list", args: [id, quantity, priceEach], account })).request),
  );
  const ev = (m.v === 2 ? parseEventLogs({ abi: outfitMarketV2Abi, logs, eventName: "Listed" }) : parseEventLogs({ abi: outfitMarketAbi, logs, eventName: "Listed" }))[0];
  if (!ev) throw new Error("no Listed event");
  return { listingId: ev.args.listingId, tx };
}

export async function buyListing(pub: PublicClient, wallet: WalletClient, m: Market, listingId: bigint, quantity: number, priceEach: bigint): Promise<Hex> {
  const total = priceEach * BigInt(quantity);
  const args = [listingId, quantity, priceEach] as const;
  if (m.v === 2) {
    await approveBem(pub, wallet, m, total);
    return (await confirmed(pub, "buy", async () => wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "buy", args, account: acct(wallet) })).request))).tx;
  }
  return (await confirmed(pub, "buy", async () => wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketAbi, functionName: "buy", args, value: total, account: acct(wallet) })).request))).tx;
}

export async function cancelListing(pub: PublicClient, wallet: WalletClient, m: Market, listingId: bigint): Promise<Hex> {
  const account = acct(wallet);
  return (
    await confirmed(pub, "cancel", async () =>
      m.v === 2
        ? wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "cancel", args: [listingId], account })).request)
        : wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketAbi, functionName: "cancel", args: [listingId], account })).request),
    )
  ).tx;
}

export async function withdrawProceeds(pub: PublicClient, wallet: WalletClient, m: Market): Promise<Hex> {
  const account = acct(wallet);
  return (
    await confirmed(pub, "withdraw", async () =>
      m.v === 2
        ? wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "withdraw", account })).request)
        : wallet.writeContract((await pub.simulateContract({ address: m.address, abi: outfitMarketAbi, functionName: "withdraw", account })).request),
    )
  ).tx;
}

export async function readDesign(pub: PublicClient, m: Market, id: bigint): Promise<OutfitDesign> {
  const r = (await pub.readContract({ address: m.address, abi: abiOf(m), functionName: "design", args: [id] })) as {
    creator: Address;
    price: bigint;
    maxSupply: number;
    minted: number;
    royaltyBps: number;
    closed: boolean;
    item?: boolean;
    name: string;
    pixels: Hex;
  };
  return { market: m.v, id, creator: r.creator, price: r.price, maxSupply: Number(r.maxSupply), minted: Number(r.minted), royaltyBps: Number(r.royaltyBps), closed: r.closed, item: r.item === true, name: r.name, pixels: r.pixels };
}

/** Every design of one market, newest first (up to `limit`). */
export async function readDesigns(pub: PublicClient, m: Market, limit = 200): Promise<OutfitDesign[]> {
  const next = (await pub.readContract({ address: m.address, abi: abiOf(m), functionName: "nextDesign" })) as bigint;
  const ids: bigint[] = [];
  for (let i = next - 1n; i >= 1n && ids.length < limit; i--) ids.push(i);
  return Promise.all(ids.map((id) => readDesign(pub, m, id)));
}

/**
 * Open listings that can still be bought: the seller still holds the copies, the listing was not retired, and
 * (market 2) it has not expired. A listing for one named buyer is kept; the screen shows who may buy it.
 */
export async function readListings(pub: PublicClient, m: Market, limit = 300): Promise<OutfitListing[]> {
  const abi = abiOf(m);
  const next = (await pub.readContract({ address: m.address, abi, functionName: "nextListing" })) as bigint;
  const now = Math.floor(Date.now() / 1000);
  const out: OutfitListing[] = [];
  for (let i = next - 1n; i >= 1n && next - i <= BigInt(limit); i--) {
    const row = (await pub.readContract({ address: m.address, abi, functionName: "listings", args: [i] })) as readonly unknown[];
    const [seller, design, quantity, priceEach, nonce] = row as readonly [Address, bigint, number, bigint, number];
    if (seller === ZERO) continue;
    const expiresAt = m.v === 2 ? Number(row[5] as bigint) : null;
    const buyer = m.v === 2 && (row[6] as Address) !== ZERO ? (row[6] as Address) : null;
    if (expiresAt !== null && expiresAt <= now) continue;
    const [live, held] = await Promise.all([
      pub.readContract({ address: m.address, abi, functionName: "listNonce", args: [seller, design] }) as Promise<number>,
      pub.readContract({ address: m.address, abi, functionName: "balanceOf", args: [seller, design] }) as Promise<bigint>,
    ]);
    if (Number(live) !== Number(nonce) || held < BigInt(quantity)) continue;
    out.push({ market: m.v, id: i, seller, design, quantity: Number(quantity), priceEach, expiresAt, buyer });
  }
  return out;
}

export async function copiesHeld(pub: PublicClient, m: Market, who: Address, ids: readonly bigint[]): Promise<bigint[]> {
  if (!ids.length) return [];
  return (await pub.readContract({ address: m.address, abi: abiOf(m), functionName: "balanceOfBatch", args: [ids.map(() => who), [...ids]] })) as bigint[];
}

export async function proceedsOwed(pub: PublicClient, m: Market, who: Address): Promise<bigint> {
  return (await pub.readContract({ address: m.address, abi: abiOf(m), functionName: "owed", args: [who] })) as bigint;
}

export async function marketFeeBps(pub: PublicClient, m: Market): Promise<number> {
  return Number(await pub.readContract({ address: m.address, abi: abiOf(m), functionName: "feeBps" }));
}

/** BEM burned by a version-2 market so far, read from the contract's own total. */
export async function bemBurned(pub: PublicClient, m: Market): Promise<bigint> {
  if (m.v !== 2) return 0n;
  return (await pub.readContract({ address: m.address, abi: outfitMarketV2Abi, functionName: "totalBurned" })) as bigint;
}

/** Format BEM base units (8 decimals) without trailing zeros. */
export function formatBem(units: bigint): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Parse a BEM amount typed by a player ("0.25") into base units; null when it is not a valid amount. */
export function parseBem(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w!) * 100_000_000n + BigInt((f + "00000000").slice(0, 8));
}
