/**
 * A23: which listings on the OKB market (OutfitMarket V1, mainnet) a sale retired. V1 does not bump a seller's listing
 * nonce on a sale, so a listing beside one that sold, unbuyable once the seller's copies were gone, comes back at its old
 * price the moment the seller holds a copy again; OutfitMarketV2 bumps it on every sale. The contract cannot change, and
 * a sold-out V1 listing is deleted from storage, so this reads V1's own Listed and Sold events and applies V2's rule:
 * a sale through one listing retires every other listing of that design by that seller made before the sale. The game
 * shows a V1 listing only when this says it is not retired and has caught up with the chain.
 */

import type { Hono } from "hono";
import { type Address, type PublicClient, createPublicClient, http, parseAbiItem } from "viem";
import { WINDOW } from "./indexer";
import { hasStore, readStore, saveJson } from "./durable";

const EVENTS = [
  parseAbiItem(
    "event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed id, uint32 quantity, uint96 priceEach)",
  ),
  parseAbiItem("event Sold(uint256 indexed listingId, address indexed buyer, uint32 quantity, uint256 paid)"),
] as const;

/** How far behind the chain's head the watch may be and still answer: one log window. */
const READY_SLACK = WINDOW;

/** The two events, as viem decodes them, with their place on the chain. */
export type MarketEvent =
  | {
      eventName: "Listed";
      args: { listingId: bigint; seller: Address; id: bigint };
      blockNumber: bigint;
      logIndex: number;
    }
  | { eventName: "Sold"; args: { listingId: bigint }; blockNumber: bigint; logIndex: number };

/** The listings V2's rule would have retired, by id: each sale retires the same seller's earlier listings of that design. */
export function retiredBy(events: readonly MarketEvent[]): Set<string> {
  const ordered = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  const listed = new Map<string, { seller: string; design: string }>();
  const retired = new Set<string>();
  for (const e of ordered) {
    const id = e.args.listingId.toString();
    if (e.eventName === "Listed") {
      listed.set(id, { seller: e.args.seller.toLowerCase(), design: e.args.id.toString() });
      continue;
    }
    const sale = listed.get(id);
    if (!sale) continue;
    for (const [other, l] of listed)
      if (other !== id && l.seller === sale.seller && l.design === sale.design) retired.add(other);
  }
  return retired;
}

interface Stored {
  next: number;
  events: Array<{
    kind: "Listed" | "Sold";
    listingId: string;
    seller?: string;
    design?: string;
    block: number;
    logIndex: number;
  }>;
}

export function createListingWatch(opts: {
  rpc: string;
  market: Address;
  fromBlock: number;
  store?: string;
  client?: PublicClient;
  paceMs?: number;
}) {
  const pub =
    opts.client ??
    (createPublicClient({ transport: http(opts.rpc, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  let data: Stored = { next: opts.fromBlock, events: [] };
  if (opts.store && hasStore(opts.store)) {
    try {
      data = readStore(opts.store) as Stored;
    } catch {
      // a damaged file starts again from the deploy block
    }
  }
  const save = () => {
    if (!opts.store) return;
    saveJson(opts.store, undefined, JSON.stringify(data));
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** The chain's head when the watch last looked; 0 before it has. */
  let head = 0;
  let running = false;

  async function catchUp(maxWindows = 400): Promise<void> {
    if (running) return;
    running = true;
    try {
      // the head as it is now: viem keeps a block number it has read for a few seconds, which would stop a catch-up short
      head = Number(await pub.getBlockNumber({ cacheTime: 0 }));
      for (let i = 0; i < maxWindows && data.next <= head; i++) {
        const from = data.next;
        const to = Math.min(head, from + WINDOW - 1);
        let logs;
        for (let attempt = 0; ; attempt++) {
          try {
            logs = (await pub.getLogs({
              address: opts.market,
              events: EVENTS,
              fromBlock: BigInt(from),
              toBlock: BigInt(to),
            })) as unknown as MarketEvent[];
            break;
          } catch (e) {
            if (attempt >= 6) throw e;
            await sleep(2000 * (attempt + 1));
          }
        }
        for (const l of logs) {
          const base = {
            listingId: l.args.listingId.toString(),
            block: Number(l.blockNumber),
            logIndex: Number(l.logIndex),
          };
          data.events.push(
            l.eventName === "Listed"
              ? { kind: "Listed", ...base, seller: l.args.seller, design: l.args.id.toString() }
              : { kind: "Sold", ...base },
          );
        }
        data.next = to + 1;
        if (opts.paceMs !== 0) await sleep(opts.paceMs ?? 300);
        if (logs.length || i % 50 === 49) save();
      }
      save();
    } finally {
      running = false;
    }
  }

  /** Whether the watch has read the market up to the chain's head (within one window), and what a sale retired. */
  function state(): { ready: boolean; retired: string[] } {
    const events: MarketEvent[] = data.events.map((e) =>
      e.kind === "Listed"
        ? {
            eventName: "Listed",
            args: { listingId: BigInt(e.listingId), seller: e.seller as Address, id: BigInt(e.design!) },
            blockNumber: BigInt(e.block),
            logIndex: e.logIndex,
          }
        : {
            eventName: "Sold",
            args: { listingId: BigInt(e.listingId) },
            blockNumber: BigInt(e.block),
            logIndex: e.logIndex,
          },
    );
    return {
      ready: head > 0 && data.next - 1 >= head - READY_SLACK,
      retired: [...retiredBy(events)].sort((a, b) => Number(a) - Number(b)),
    };
  }

  return { catchUp, state, head: () => data.next - 1 };
}
export type ListingWatch = ReturnType<typeof createListingWatch>;

/** GET /api/market/retired: { ready, retired } for the OKB market's listings (A23). */
export function withRetiredListings(app: Hono, watch: ListingWatch): Hono {
  app.get("/api/market/retired", (c) => c.json(watch.state()));
  return app;
}
