/**
 * Who opened each red packet (A1). The contract keeps no list of claims, only its events, and X Layer's public nodes
 * answer log queries over at most 100 blocks, while a packet lives for days. So the server walks forward in windows
 * from the contract's deploy block, keeps its place in a file, and serves each packet's claims. Every claim it lists
 * is an on-chain event anyone can re-read: each carries its transaction.
 *
 * The store a crowd could grow is bounded: a packet is forgotten 30 days after it closes, and never more than
 * MAX_CLAIMS claims are kept, the packets that closed longest ago going first.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { WINDOW } from "./indexer";

const EVENTS = [
  parseAbiItem("event Created(uint256 indexed id, address indexed sender, address token, uint256 total, uint16 count, bool lucky, bool petOwnersOnly, uint64 expiry)"),
  parseAbiItem("event Claimed(uint256 indexed id, address indexed claimer, uint256 amount, uint16 index, uint16 sealInput, uint8 sealOutput)"),
] as const;

/** RedPacket.REVEAL_GRACE: a lucky packet's last shares can still be revealed this long after it expires. */
const REVEAL_GRACE_S = 3_600;
/** How long a closed packet's claims stay listed. */
const KEEP_AFTER_CLOSE_S = 30 * 86_400;
/** The most claims kept in all. */
export const MAX_CLAIMS = 100_000;
const STORE_VERSION = 1;

export interface PacketClaim {
  claimer: string;
  /** in the token's smallest unit, as a decimal string */
  amount: string;
  index: number;
  sealInput: number;
  sealOutput: number;
  tx: string;
  block: number;
}

interface PacketRecord {
  created?: { block: number; tx: string; sender: string; token: string; total: string; count: number; lucky: boolean; petOwnersOnly: boolean; expiry: number };
  claims: PacketClaim[];
}

interface Stored {
  v: number;
  next: number;
  packets: Record<string, PacketRecord>;
}

export interface PacketIndexOptions {
  rpc?: string;
  address: Address;
  fromBlock: number;
  store?: string;
  client?: PublicClient;
  paceMs?: number;
  /** seconds since the epoch, for forgetting closed packets */
  now?: () => number;
  maxClaims?: number;
}

export function createPacketIndex(opts: PacketIndexOptions) {
  const pub = opts.client ?? (createPublicClient({ transport: http(opts.rpc ?? "https://xlayerrpc.okx.com", { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const maxClaims = opts.maxClaims ?? MAX_CLAIMS;
  let data: Stored = { v: STORE_VERSION, next: opts.fromBlock, packets: {} };
  if (opts.store && existsSync(opts.store)) {
    try {
      const held = JSON.parse(readFileSync(opts.store, "utf8")) as Stored;
      if (held.v === STORE_VERSION && Number.isInteger(held.next)) data = held;
    } catch {
      // a damaged file starts again from the deploy block: every claim is on chain to be read again
    }
  }
  const save = () => {
    if (!opts.store) return;
    writeFileSync(`${opts.store}.tmp`, JSON.stringify(data));
    renameSync(`${opts.store}.tmp`, opts.store);
  };
  const packet = (id: string): PacketRecord => (data.packets[id] ??= { claims: [] });
  /** Each packet's shares already listed (a share is claimed once), so a window read again adds nothing twice. */
  const listed = new Map<string, Set<number>>();
  const listedIn = (id: string): Set<number> => {
    let s = listed.get(id);
    if (!s) listed.set(id, (s = new Set((data.packets[id]?.claims ?? []).map((c) => c.index))));
    return s;
  };
  /** When a packet stops taking claims, in seconds (unknown for one whose creation the index has not seen). */
  const closesAt = (r: PacketRecord) => (r.created ? r.created.expiry + REVEAL_GRACE_S : null);

  /** Forgets packets closed long ago, then the longest closed while there are too many claims. Open packets stay. */
  function prune(): void {
    const t = now();
    for (const [id, r] of Object.entries(data.packets)) {
      const closes = closesAt(r);
      if (closes !== null && closes + KEEP_AFTER_CLOSE_S < t) {
        delete data.packets[id];
        listed.delete(id);
      }
    }
    let total = Object.values(data.packets).reduce((n, r) => n + r.claims.length, 0);
    if (total <= maxClaims) return;
    const closed = Object.entries(data.packets)
      .filter(([, r]) => (closesAt(r) ?? Infinity) < t)
      .sort((a, b) => closesAt(a[1])! - closesAt(b[1])!);
    for (const [id, r] of closed) {
      if (total <= maxClaims) break;
      total -= r.claims.length;
      delete data.packets[id];
      listed.delete(id);
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** One log query over at most WINDOW blocks, paced and patient with the public nodes' rate limits. */
  async function logsIn(from: number, to: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        const logs = await pub.getLogs({ address: opts.address, events: EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) });
        await sleep(opts.paceMs ?? 400);
        return logs;
      } catch (e) {
        if (attempt >= 6) throw e;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  let running = false;
  /** Reads forward to the chain's head, at most `maxWindows` windows; returns how many events were added. */
  async function catchUp(maxWindows = 400): Promise<number> {
    if (running) return 0;
    running = true;
    let added = 0;
    try {
      const head = Number(await pub.getBlockNumber());
      for (let i = 0; i < maxWindows && data.next <= head; i++) {
        const to = Math.min(head, data.next + WINDOW - 1);
        const logs = await logsIn(data.next, to);
        for (const l of logs) {
          const a = l.args as Record<string, bigint | number | string | boolean>;
          const id = String(a.id);
          const block = Number(l.blockNumber);
          const tx = l.transactionHash!;
          if (l.eventName === "Created") {
            packet(id).created = { block, tx, sender: String(a.sender), token: String(a.token), total: String(a.total), count: Number(a.count), lucky: Boolean(a.lucky), petOwnersOnly: Boolean(a.petOwnersOnly), expiry: Number(a.expiry) };
          } else {
            const index = Number(a.index);
            const seen = listedIn(id);
            if (!seen.has(index)) {
              seen.add(index);
              packet(id).claims.push({ claimer: String(a.claimer), amount: String(a.amount), index, sealInput: Number(a.sealInput), sealOutput: Number(a.sealOutput), tx, block });
            }
          }
          added++;
        }
        data.next = to + 1;
        if (logs.length || i % 50 === 49) save();
      }
      prune();
      save();
    } finally {
      running = false;
    }
    return added;
  }

  return {
    catchUp,
    /** The last block read. */
    head: () => data.next - 1,
    /** A packet's claims in the order they were made, or null when the index has seen nothing of it. */
    claimsOf(id: string): { claims: PacketClaim[]; created: PacketRecord["created"] | null } | null {
      const r = data.packets[id];
      if (!r) return null;
      return { claims: [...r.claims].sort((x, y) => x.block - y.block || x.index - y.index), created: r.created ?? null };
    },
    size: () => ({ packets: Object.keys(data.packets).length, claims: Object.values(data.packets).reduce((n, r) => n + r.claims.length, 0) }),
  };
}
export type PacketIndex = ReturnType<typeof createPacketIndex>;
