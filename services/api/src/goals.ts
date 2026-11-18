/**
 * Community goals (plan 4.10): every contribution read from X Layer. One walk over the pet registry, the BEM
 * breeder and the BEM market, in the public nodes' 100-block windows, keeps a ledger of what each wallet did:
 *
 *   saves     PetRegistry Checkpoint   each pet-day once (a day saved again does not count), for the pet's owner then
 *   hatched   PetRegistry Hatched      a new pet (a child is hatched too), counted when it is settled: at the
 *                                      Checkpoint that saves its SETTLED_DAYS-th different day, for the wallet it
 *                                      was hatched for
 *   children  PetRegistry Bred         credited to the child's owner (its mint comes first in the same transaction)
 *   burned    Burned (Lingxi's BEM contracts) the BEM sent to the dead address, credited to the payer
 *
 * Owners are followed through the registry's Transfer events from its deploy block, so a pet given away credits
 * its new owner. A goal's total is the sum of its metric over the goal's window, by block time, with no wallet
 * counting for more than walletCap(goal); anyone can recount it from the same events
 * (packages/chain/scripts/recount-numbers.ts does, by its own walk).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Hono } from "hono";
import { type Address, type PublicClient, createPublicClient, http, parseAbiItem } from "viem";
import { GOALS, type GoalDef, type GoalMetric, SETTLED_DAYS, goalState, tiersReached, walletCap } from "@lingxi/world";
import { WINDOW } from "./indexer";

export const GOAL_EVENTS = [
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
  parseAbiItem("event Hatched(uint256 indexed petId, address indexed to, uint8 line, address processor, uint64 brainId, uint256 state)"),
  parseAbiItem("event Bred(uint256 indexed petId, uint128 indexed parentA, uint128 indexed parentB)"),
  parseAbiItem("event Checkpoint(uint256 indexed petId, uint32 indexed day, uint256 state, bytes32 logHash)"),
  parseAbiItem("event Burned(address indexed payer, uint256 amount)"),
] as const;

/** One counted thing: metric, wallet (lower case), amount, block, block time, transaction. */
export interface Entry {
  m: GoalMetric;
  w: string;
  n: number;
  b: number;
  t: number;
  tx: string;
}

/** A pet the ledger has seen hatch: who it was hatched for, the days of it saved so far, and whether it has counted. */
interface PetSeen {
  to: string;
  days: number[];
  counted: boolean;
}

interface Stored {
  /** 2: settled pets and single-counted days (a version 1 file is read again from the deploy block) */
  v: 2;
  next: number;
  owners: Record<string, string>;
  pets: Record<string, PetSeen>;
  entries: Entry[];
}

export interface GoalLedgerOptions {
  rpc: string;
  registry: Address;
  /** contracts whose Burned events count (the BEM breeder and the BEM market) */
  burners: Address[];
  /** the registry's deploy block: owners must be followed from the first mint */
  fromBlock: number;
  store?: string;
  client?: PublicClient;
  paceMs?: number;
}

export function createGoalLedger(opts: GoalLedgerOptions) {
  const pub = opts.client ?? (createPublicClient({ transport: http(opts.rpc, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  const registry = opts.registry.toLowerCase();
  const burners = new Set(opts.burners.map((a) => a.toLowerCase()));
  let data: Stored = { v: 2, next: opts.fromBlock, owners: {}, pets: {}, entries: [] };
  if (opts.store && existsSync(opts.store)) {
    try {
      const held = JSON.parse(readFileSync(opts.store, "utf8")) as Stored;
      if (held.v === 2) data = held;
    } catch {
      // a damaged file is read again from the deploy block
    }
  }
  const save = () => {
    if (!opts.store) return;
    writeFileSync(`${opts.store}.tmp`, JSON.stringify(data));
    renameSync(`${opts.store}.tmp`, opts.store);
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const times = new Map<number, number>();
  const timeOf = async (block: number) => {
    if (!times.has(block)) times.set(block, Number((await pub.getBlock({ blockNumber: BigInt(block) })).timestamp));
    return times.get(block)!;
  };
  let running = false;

  async function logsIn(from: number, to: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await pub.getLogs({ address: [opts.registry, ...opts.burners], events: GOAL_EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) });
      } catch (e) {
        if (attempt >= 6) throw e;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  /** Read forward to the chain's head; returns how many entries were added. */
  async function catchUp(maxWindows = 400): Promise<number> {
    if (running) return 0;
    running = true;
    let added = 0;
    try {
      const head = Number(await pub.getBlockNumber());
      for (let i = 0; i < maxWindows && data.next <= head; i++) {
        const to = Math.min(head, data.next + WINDOW - 1);
        const logs = [...(await logsIn(data.next, to))].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
        const owners = { ...data.owners };
        const pets = { ...data.pets };
        const fresh: Entry[] = [];
        for (const l of logs) {
          const at = l.address.toLowerCase();
          const a = l.args as Record<string, bigint | string>;
          const b = Number(l.blockNumber);
          const tx = l.transactionHash!;
          const add = async (m: GoalMetric, w: string | undefined, n: number) => {
            if (!w || !(n > 0)) return;
            fresh.push({ m, w: w.toLowerCase(), n, b, t: await timeOf(b), tx });
          };
          if (at === registry) {
            if (l.eventName === "Transfer") owners[String(a.tokenId)] = String(a.to).toLowerCase();
            else if (l.eventName === "Hatched") pets[String(a.petId)] = { to: String(a.to).toLowerCase(), days: [], counted: false };
            else if (l.eventName === "Bred") await add("children", owners[String(a.petId)], 1);
            else if (l.eventName === "Checkpoint") {
              const id = String(a.petId);
              const day = Number(a.day);
              const seen = pets[id];
              // a day saved again counts once
              if (!seen || seen.days.includes(day)) continue;
              const days = [...seen.days, day];
              await add("saves", owners[id], 1);
              // the pet is settled when its SETTLED_DAYS-th different day is saved: then it counts as a new pet
              const settles = !seen.counted && days.length >= SETTLED_DAYS;
              if (settles) await add("hatched", seen.to, 1);
              pets[id] = { ...seen, days, counted: seen.counted || settles };
            }
          } else if (burners.has(at) && l.eventName === "Burned") await add("burned", String(a.payer), Number(a.amount));
        }
        data = { ...data, next: to + 1, owners, pets, entries: fresh.length ? [...data.entries, ...fresh] : data.entries };
        added += fresh.length;
        await sleep(opts.paceMs ?? 400);
        if (fresh.length || i % 50 === 49) save();
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
    entries: (): readonly Entry[] => data.entries,
  };
}
export type GoalLedger = ReturnType<typeof createGoalLedger>;

export interface GoalReport {
  id: string;
  metric: GoalMetric;
  target: number;
  start: number;
  end: number;
  state: ReturnType<typeof goalState>;
  /** everything counted in the window, each wallet up to `cap`; progress stops at the target, the total does not */
  total: number;
  /** the most one wallet counts for in this goal */
  cap: number;
  tiers: number[];
  contributors: number;
  /** the ten who gave most, with their share of the total */
  top: Array<{ wallet: string; n: number; share: number }>;
  /** what the asked-for wallets gave together */
  mine: number;
}

/** Each goal's standing from the ledger, as of `nowSec`. */
export function reportGoals(entries: readonly Entry[], goals: readonly GoalDef[], nowSec: number, wallets: readonly string[] = []): GoalReport[] {
  const mineSet = new Set(wallets.map((w) => w.toLowerCase()));
  return goals.map((g) => {
    const cap = walletCap(g);
    const by = new Map<string, number>();
    for (const e of entries) if (e.m === g.metric && e.t >= g.start && e.t < g.end) by.set(e.w, (by.get(e.w) ?? 0) + e.n);
    // no wallet counts for more than its share, so no one finishes a goal alone
    for (const [w, n] of by) by.set(w, Math.min(n, cap));
    const total = [...by.values()].reduce((s, n) => s + n, 0);
    const top = [...by.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([wallet, n]) => ({ wallet, n, share: total ? n / total : 0 }));
    const mine = [...by.entries()].filter(([w]) => mineSet.has(w)).reduce((s, [, n]) => s + n, 0);
    return { id: g.id, metric: g.metric, target: g.target, start: g.start, end: g.end, state: goalState(g, total, nowSec), total, cap, tiers: tiersReached(g, total), contributors: by.size, top, mine };
  });
}

const WALLET = /^0x[0-9a-fA-F]{40}$/;

/** GET /api/goals[?wallet=0x…,0x…]: every goal's standing, read from the chain; any origin may read it. */
export function withGoals(app: Hono, ledger: Pick<GoalLedger, "entries" | "head">, goals: readonly GoalDef[] = GOALS): Hono {
  app.get("/api/goals", (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "no-store");
    const raw = (c.req.query("wallet") ?? "").split(",").filter(Boolean);
    if (raw.length > 8 || raw.some((w) => !WALLET.test(w))) return c.json({ ok: false, reason: "wallet" }, 400);
    const now = Math.floor(Date.now() / 1000);
    return c.json({ ok: true, now, indexedTo: ledger.head(), goals: reportGoals(ledger.entries(), goals, now, raw) });
  });
  return app;
}
