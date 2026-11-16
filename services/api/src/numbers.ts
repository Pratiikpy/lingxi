/**
 * Live numbers (plan 4.10): what Lingxi has done on X Layer, read from the chain. Pet counts come from the pet
 * indexer (PetRegistry's events); outfit sales from the two markets' Minted and Sold events, read here in the
 * same 100-block windows; burned BEM, pins claimed and pets hatched from the contracts' own views. Each number
 * carries the contract it comes from and what it counts, so anyone can check it.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Hono } from "hono";
import { type Address, type PublicClient, createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { WINDOW } from "./indexer";

const SALES = [
  parseAbiItem("event Minted(uint256 indexed id, address indexed buyer, uint32 quantity, uint256 paid)"),
  parseAbiItem("event Sold(uint256 indexed listingId, address indexed buyer, uint32 quantity, uint256 paid)"),
] as const;
const views = parseAbi([
  "function totalBurned() view returns (uint256)",
  "function total() view returns (uint256)",
  "function nextPetId() view returns (uint256)",
]);

export interface MarketTotals {
  /** copies sold by creators and by resellers */
  copies: number;
  /** what buyers paid, in the market's own currency's base units */
  paid: string;
  sales: number;
}

interface Stored {
  next: Record<string, number>;
  totals: Record<string, { copies: number; paid: string; sales: number }>;
}

/** Counts every sale on the given markets, walking forward from each market's deploy block. */
export function createSalesCounter(opts: { rpc: string; markets: Array<{ address: Address; fromBlock: number }>; store?: string; client?: PublicClient; paceMs?: number }) {
  const pub = opts.client ?? (createPublicClient({ transport: http(opts.rpc, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  let data: Stored = { next: {}, totals: {} };
  if (opts.store && existsSync(opts.store)) {
    try {
      data = JSON.parse(readFileSync(opts.store, "utf8")) as Stored;
    } catch {
      // a damaged file starts again from the deploy blocks
    }
  }
  for (const m of opts.markets) {
    const k = m.address.toLowerCase();
    data.next[k] ??= m.fromBlock;
    data.totals[k] ??= { copies: 0, paid: "0", sales: 0 };
  }
  const save = () => {
    if (!opts.store) return;
    writeFileSync(`${opts.store}.tmp`, JSON.stringify(data));
    renameSync(`${opts.store}.tmp`, opts.store);
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let running = false;

  async function catchUp(maxWindows = 400): Promise<void> {
    if (running) return;
    running = true;
    try {
      const head = Number(await pub.getBlockNumber());
      for (const m of opts.markets) {
        const k = m.address.toLowerCase();
        for (let i = 0; i < maxWindows && data.next[k]! <= head; i++) {
          const from = data.next[k]!;
          const to = Math.min(head, from + WINDOW - 1);
          let logs;
          for (let attempt = 0; ; attempt++) {
            try {
              logs = await pub.getLogs({ address: m.address, events: SALES, fromBlock: BigInt(from), toBlock: BigInt(to) });
              break;
            } catch (e) {
              if (attempt >= 6) throw e;
              await sleep(2000 * (attempt + 1));
            }
          }
          const t = data.totals[k]!;
          for (const l of logs) {
            const a = l.args as { quantity: number; paid: bigint };
            t.copies += Number(a.quantity);
            t.paid = (BigInt(t.paid) + a.paid).toString();
            t.sales += 1;
          }
          data.next[k] = to + 1;
          await sleep(opts.paceMs ?? 300);
          if (logs.length || i % 50 === 49) save();
        }
      }
      save();
    } finally {
      running = false;
    }
  }

  return {
    catchUp,
    totals: (market: Address): MarketTotals => ({ ...data.totals[market.toLowerCase()]! }),
    head: (market: Address) => (data.next[market.toLowerCase()] ?? 0) - 1,
  };
}
export type SalesCounter = ReturnType<typeof createSalesCounter>;

export interface NumbersDeps {
  pub: PublicClient;
  counts: (sinceSec: number) => { hatched: number; children: number; saves: number; savedSince: number; hatchers: number };
  petsIndexedTo: () => number;
  sales: SalesCounter;
  contracts: { registry: Address; marketOkb?: Address; marketBem?: Address; breeder?: Address; gift?: Address; itemShop?: Address };
  explorer: string;
}

export interface Numbers {
  ok: true;
  at: number;
  /** the chain's latest block when read: a count whose indexedTo is far behind it is still catching up */
  head: number;
  pets: { hatched: number; children: number; daysSaved: number; savedLast24h: number; hatchers: number; nextPetId: number; indexedTo: number };
  outfits: { okb: (MarketTotals & { indexedTo: number }) | null; bem: (MarketTotals & { indexedTo: number }) | null };
  burned: { market: string; breeding: string; shop: string; total: string };
  pins: number | null;
  contracts: Record<string, { address: Address; url: string }>;
}

export async function readNumbers(d: NumbersDeps, nowMs = Date.now()): Promise<Numbers> {
  const read = async (address: Address | undefined, fn: "totalBurned" | "total" | "nextPetId"): Promise<bigint> =>
    address ? ((await d.pub.readContract({ address, abi: views, functionName: fn })) as bigint) : 0n;
  const [head, nextPetId, marketBurned, breedingBurned, shopBurned, pins] = await Promise.all([
    d.pub.getBlockNumber(),
    read(d.contracts.registry, "nextPetId"),
    read(d.contracts.marketBem, "totalBurned"),
    read(d.contracts.breeder, "totalBurned"),
    read(d.contracts.itemShop, "totalBurned"),
    d.contracts.gift ? read(d.contracts.gift, "total") : Promise.resolve(null),
  ]);
  const c = d.counts(Math.floor(nowMs / 1000) - 86_400);
  const market = (a?: Address) => (a ? { ...d.sales.totals(a), indexedTo: d.sales.head(a) } : null);
  const contracts: Numbers["contracts"] = {};
  for (const [k, a] of Object.entries(d.contracts)) if (a) contracts[k] = { address: a, url: `${d.explorer}/address/${a}` };
  return {
    ok: true,
    at: nowMs,
    head: Number(head),
    pets: { hatched: c.hatched, children: c.children, daysSaved: c.saves, savedLast24h: c.savedSince, hatchers: c.hatchers, nextPetId: Number(nextPetId), indexedTo: d.petsIndexedTo() },
    outfits: { okb: market(d.contracts.marketOkb), bem: market(d.contracts.marketBem) },
    burned: { market: marketBurned.toString(), breeding: breedingBurned.toString(), shop: shopBurned.toString(), total: (marketBurned + breedingBurned + shopBurned).toString() },
    pins: pins === null ? null : Number(pins),
    contracts,
  };
}

/** GET /api/numbers: the live numbers, cached for a minute; readable from any origin (the DeWEB copy reads it too). */
export function withNumbers(app: Hono, d: NumbersDeps): Hono {
  let cache: { at: number; body: Numbers } | null = null;
  app.get("/api/numbers", async (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "public, max-age=60");
    if (!cache || Date.now() - cache.at > 60_000) {
      try {
        cache = { at: Date.now(), body: await readNumbers(d) };
      } catch {
        if (!cache) return c.json({ ok: false, reason: "chain" }, 503);
      }
    }
    return c.json(cache.body);
  });
  return app;
}
