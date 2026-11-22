/**
 * A small indexer for pet history (web build): every pet's hatching, daily saves,
 * brain changes and family, read from PetRegistry's events. X Layer's public nodes
 * answer log queries only over short block ranges, so it walks forward in windows
 * and keeps its place in a file. Nothing here is trusted by the proof page beyond
 * display: every state it lists is an on-chain event anyone can re-read.
 */

import { createPublicClient, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { hasStore, readStore, saveJson } from "./durable";

const EVENTS = [
  parseAbiItem("event Hatched(uint256 indexed petId, address indexed to, uint8 line, address processor, uint64 brainId, uint256 state)"),
  parseAbiItem("event Bred(uint256 indexed petId, uint128 indexed parentA, uint128 indexed parentB)"),
  parseAbiItem("event BrainChanged(uint256 indexed petId, address processor, uint64 brainId, uint8 brainBits)"),
  parseAbiItem("event Checkpoint(uint256 indexed petId, uint32 indexed day, uint256 state, bytes32 logHash)"),
] as const;

export interface PetHistory {
  /** `by` is who sent the hatch: the owner's own wallet when it equals `to`, Lingxi's relayer for a sponsored keep (H10) */
  hatched?: { block: number; tx: string; line: number; brainId: string; state: string; to?: string; by?: string };
  parents?: [string, string];
  children: string[];
  saves: Array<{ day: number; state: string; logHash: string; block: number; tx: string }>;
  brains: Array<{ brainId: string; bits: number; block: number; tx: string }>;
}

/** Bumped when the stored shape gains a field that only a fresh read can fill. */
const STORE_VERSION = 2;

interface Stored {
  v?: number;
  next: number;
  pets: Record<string, PetHistory>;
  /** block → timestamp (seconds), for blocks that carry events */
  times: Record<string, number>;
}

/** Blocks per log query: X Layer's public nodes refuse ranges over 100 ("block range greater than 100 max"). */
export const WINDOW = 100;

export function createIndexer(opts: { rpc: string; registry: Address; fromBlock: number; store?: string; client?: PublicClient; paceMs?: number }) {
  const pub = opts.client ?? (createPublicClient({ transport: http(opts.rpc, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  // the two official X Layer nodes take turns, halving the load on each
  const pubs: PublicClient[] = opts.client ? [opts.client] : [opts.rpc, ...["https://xlayerrpc.okx.com", "https://rpc.xlayer.tech"].filter((u) => u !== opts.rpc && opts.rpc.includes("xlayer"))].map((u) => createPublicClient({ transport: http(u, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  let data: Stored = { v: STORE_VERSION, next: opts.fromBlock, pets: {}, times: {} };
  if (opts.store && hasStore(opts.store)) {
    try {
      const held = readStore(opts.store) as Stored;
      // an older file lacks fields (who each pet was hatched for): read the chain again
      if (held.v === STORE_VERSION) data = held;
    } catch {
      // a damaged file starts again from the deploy block
    }
  }
  const save = () => {
    if (!opts.store) return;
    saveJson(opts.store, undefined, JSON.stringify(data));
  };
  const pet = (id: string): PetHistory => (data.pets[id] ??= { children: [], saves: [], brains: [] });
  let running = false;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** One log query, paced and patient with the public nodes' rate limits. */
  async function logsIn(from: number, to: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        const client = pubs[(from / WINDOW) % pubs.length | 0]!;
        const logs = await client.getLogs({ address: opts.registry, events: EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) });
        await sleep(opts.paceMs ?? 400);
        return logs;
      } catch (e) {
        if (attempt >= 6) throw e;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  /** Who sent a transaction (the hatch's sender says who kept the pet). */
  const senderOf = async (tx: string): Promise<string> => String((await pub.getTransaction({ hash: tx as `0x${string}` })).from).toLowerCase();

  /** Read forward to the chain's head; returns how many events were added. Saves as it goes. */
  async function catchUp(maxWindows = 400): Promise<number> {
    if (running) return 0;
    running = true;
    let added = 0;
    try {
      // pets indexed before the hatch's sender was recorded get it now, from their own transactions
      let filled = false;
      for (const h of Object.values(data.pets))
        if (h.hatched && !h.hatched.by) {
          h.hatched.by = await senderOf(h.hatched.tx);
          filled = true;
        }
      if (filled) save();
      // the head as it is now: viem keeps a block number it has read for a few seconds, which would stop a catch-up short
      const head = Number(await pub.getBlockNumber({ cacheTime: 0 }));
      for (let i = 0; i < maxWindows && data.next <= head; i++) {
        const to = Math.min(head, data.next + WINDOW - 1);
        const logs = await logsIn(data.next, to);
        for (const l of logs) {
          const block = Number(l.blockNumber);
          const tx = l.transactionHash!;
          const a = l.args as Record<string, bigint | number | string>;
          const id = String(a.petId);
          if (l.eventName === "Hatched") pet(id).hatched = { block, tx, line: Number(a.line), brainId: String(a.brainId), state: String(a.state), to: String(a.to), by: await senderOf(tx) };
          else if (l.eventName === "Bred") {
            pet(id).parents = [String(a.parentA), String(a.parentB)];
            for (const p of [String(a.parentA), String(a.parentB)]) if (!pet(p).children.includes(id)) pet(p).children.push(id);
          } else if (l.eventName === "BrainChanged") pet(id).brains.push({ brainId: String(a.brainId), bits: Number(a.brainBits), block, tx });
          else if (l.eventName === "Checkpoint") pet(id).saves.push({ day: Number(a.day), state: String(a.state), logHash: String(a.logHash), block, tx });
          if (!data.times[block]) data.times[block] = Number((await pub.getBlock({ blockNumber: BigInt(block) })).timestamp);
          added++;
        }
        data.next = to + 1;
        if (logs.length || i % 50 === 49) save();
      }
      save();
    } finally {
      running = false;
    }
    return added;
  }

  return {
    catchUp,
    head: () => data.next - 1,
    /** Every pet hatched or bred, for the tree of life. */
    pets(): Array<{ id: string; line: number; owner: string | null; parents: [string, string] | null; children: string[]; block: number; tx: string; at: number }> {
      return Object.entries(data.pets)
        .filter(([, h]) => h.hatched)
        .map(([id, h]) => ({ id, line: h.hatched!.line, owner: h.hatched!.to ?? null, parents: h.parents ?? null, children: [...h.children], block: h.hatched!.block, tx: h.hatched!.tx, at: data.times[h.hatched!.block] ?? 0 }));
    },
    /**
     * Counts for the live-numbers page, all from PetRegistry's own events: pets hatched (from starters),
     * children born, days saved, distinct pets saved since `sinceSec`, and distinct wallets pets were hatched for.
     */
    counts(sinceSec: number): { hatched: number; children: number; saves: number; savedSince: number; hatchers: number } {
      let hatched = 0;
      let children = 0;
      let saves = 0;
      let savedSince = 0;
      const hatchers = new Set<string>();
      for (const h of Object.values(data.pets)) {
        if (h.hatched) {
          if (h.parents) children++;
          else hatched++;
          if (h.hatched.to) hatchers.add(h.hatched.to.toLowerCase());
        }
        saves += h.saves.length;
        if (h.saves.some((x) => (data.times[x.block] ?? 0) >= sinceSec)) savedSince++;
      }
      return { hatched, children, saves, savedSince, hatchers: hatchers.size };
    },
    /** What happened on chain since `sinceSec` (H10): pets hatched and born, days saved, pets saved, wallets that hatched. */
    activity(sinceSec: number): { hatched: number; children: number; saves: number; petsSaved: number; hatchers: number } {
      let hatched = 0;
      let children = 0;
      let saves = 0;
      let petsSaved = 0;
      const hatchers = new Set<string>();
      for (const h of Object.values(data.pets)) {
        if (h.hatched && (data.times[h.hatched.block] ?? 0) >= sinceSec) {
          if (h.parents) children++;
          else hatched++;
          if (h.hatched.to) hatchers.add(h.hatched.to.toLowerCase());
        }
        const recent = h.saves.filter((x) => (data.times[x.block] ?? 0) >= sinceSec).length;
        saves += recent;
        if (recent) petsSaved++;
      }
      return { hatched, children, saves, petsSaved, hatchers: hatchers.size };
    },
    /**
     * Who kept each pet on X Layer (H10), by the hatch's sender: its owner's own wallet (the sender is the wallet it was
     * hatched for), Lingxi's relayer (a sponsored keep), or another wallet. A pet whose sender is not known yet is in none.
     */
    keepers(sponsors: readonly string[]): { own: number; sponsored: number; other: number } {
      const relay = new Set(sponsors.map((x) => x.toLowerCase()));
      let own = 0;
      let sponsored = 0;
      let other = 0;
      for (const h of Object.values(data.pets)) {
        const k = h.hatched;
        if (!k?.by) continue;
        if (relay.has(k.by)) sponsored++;
        else if (k.to && k.by === k.to.toLowerCase()) own++;
        else other++;
      }
      return { own, sponsored, other };
    },
    history(id: string): (PetHistory & { at: Record<string, number> }) | null {
      const h = data.pets[id];
      if (!h) return null;
      const blocks = [h.hatched?.block, ...h.saves.map((s) => s.block), ...h.brains.map((b) => b.block)].filter((b): b is number => b !== undefined);
      return { ...h, at: Object.fromEntries(blocks.map((b) => [b, data.times[b] ?? 0])) };
    },
  };
}
export type Indexer = ReturnType<typeof createIndexer>;
