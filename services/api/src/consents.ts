/**
 * Breeding consents on X Layer (A63). Saying yes to a little one signs `allowPartner(pet, wallet, true)` on a breeder,
 * and the consent stands until that wallet uses it once, the pet is sold, or its owner withdraws it. The breeders keep
 * consents in a mapping a page cannot list, and X Layer's public nodes answer log queries over at most 100 blocks, so
 * the server walks both breeders' Consent events forward in windows, keeps its place in a file, and serves each pet's
 * partners whose latest event allowed them.
 *
 * A consent used to breed is cleared without an event, so this list can name one that no longer stands: the game asks
 * the breeder's own `consent()` view about each before it shows it. The store is bounded by the chain: every entry is
 * a transaction someone paid for, and a withdrawn consent is removed.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Hono } from "hono";
import { type Address, type PublicClient, createPublicClient, http, parseAbiItem } from "viem";
import { WINDOW } from "./indexer";

const EVENTS = [parseAbiItem("event Consent(uint256 indexed petId, address indexed partnerOwner, bool allowed)")] as const;
const STORE_VERSION = 1;
/** The most consents listed for one pet, newest kept: each is confirmed on chain by the page that asks. */
export const MAX_LISTED = 50;

export interface StandingConsent {
  /** the breeder it was given on, lower case */
  breeder: string;
  /** the wallet it lets breed with the pet, lower case */
  partner: string;
  block: number;
  tx: string;
}

interface Given {
  block: number;
  index: number;
  tx: string;
}

interface Stored {
  v: number;
  next: number;
  /** pet id → "breeder partner" → the event that allowed it */
  pets: Record<string, Record<string, Given>>;
}

export interface ConsentIndexOptions {
  rpc?: string;
  breeders: Address[];
  /** a block at or before the first breeder's deployment */
  fromBlock: number;
  store?: string;
  client?: PublicClient;
  paceMs?: number;
}

export function createConsentIndex(opts: ConsentIndexOptions) {
  const pub = opts.client ?? (createPublicClient({ transport: http(opts.rpc ?? "https://xlayerrpc.okx.com", { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  const breeders = opts.breeders.map((a) => a.toLowerCase() as Address);
  let data: Stored = { v: STORE_VERSION, next: opts.fromBlock, pets: {} };
  if (opts.store && existsSync(opts.store)) {
    try {
      const held = JSON.parse(readFileSync(opts.store, "utf8")) as Stored;
      if (held.v === STORE_VERSION && Number.isInteger(held.next)) data = held;
    } catch {
      // a damaged file starts again from the first block: every consent is on chain to be read again
    }
  }
  const save = () => {
    if (!opts.store) return;
    writeFileSync(`${opts.store}.tmp`, JSON.stringify(data));
    renameSync(`${opts.store}.tmp`, opts.store);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** One log query over at most WINDOW blocks, paced and patient with the public nodes' rate limits. */
  async function logsIn(from: number, to: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        const logs = await pub.getLogs({ address: breeders, events: EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) });
        await sleep(opts.paceMs ?? 400);
        return logs;
      } catch (e) {
        if (attempt >= 6) throw e;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  let running = false;
  /** Reads forward to the chain's head, at most `maxWindows` windows; returns how many events were read. */
  async function catchUp(maxWindows = 400): Promise<number> {
    if (running) return 0;
    running = true;
    let read = 0;
    try {
      // the head as it is now: viem keeps a block number it has read for a few seconds, which would stop a catch-up short
      const head = Number(await pub.getBlockNumber({ cacheTime: 0 }));
      for (let i = 0; i < maxWindows && data.next <= head; i++) {
        const to = Math.min(head, data.next + WINDOW - 1);
        // the last event for a pet and partner decides, so they are taken in the chain's order
        const logs = [...(await logsIn(data.next, to))].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
        for (const l of logs) {
          const a = l.args as { petId: bigint; partnerOwner: string; allowed: boolean };
          const pet = String(a.petId);
          const key = `${l.address.toLowerCase()} ${a.partnerOwner.toLowerCase()}`;
          const given = (data.pets[pet] ??= {});
          if (a.allowed) given[key] = { block: Number(l.blockNumber), index: Number(l.logIndex), tx: l.transactionHash! };
          else {
            delete given[key];
            if (!Object.keys(given).length) delete data.pets[pet];
          }
          read++;
        }
        data.next = to + 1;
        if (logs.length || i % 50 === 49) save();
      }
      save();
    } finally {
      running = false;
    }
    return read;
  }

  return {
    catchUp,
    /** The last block read. */
    head: () => data.next - 1,
    /** A pet's partners whose latest consent event allowed them, oldest first; at most MAX_LISTED, the newest kept. */
    of(pet: string): StandingConsent[] {
      const given = data.pets[pet] ?? {};
      return Object.entries(given)
        .sort((x, y) => x[1].block - y[1].block || x[1].index - y[1].index)
        .slice(-MAX_LISTED)
        .map(([key, g]) => {
          const [breeder, partner] = key.split(" ") as [string, string];
          return { breeder, partner, block: g.block, tx: g.tx };
        });
    },
  };
}
export type ConsentIndex = ReturnType<typeof createConsentIndex>;

/** GET /api/consents/:pet — the consents the breeders' events say stand for a pet; the game confirms each on chain. */
export function withConsents(app: Hono, index: Pick<ConsentIndex, "of" | "head">): Hono {
  app.get("/api/consents/:pet", (c) => {
    const pet = c.req.param("pet");
    if (!/^\d{1,20}$/.test(pet)) return c.json({ ok: false, reason: "invalid" }, 400);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, petId: pet, indexedTo: index.head(), consents: index.of(pet) });
  });
  return app;
}
