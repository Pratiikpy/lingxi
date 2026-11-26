/**
 * Today's challenge: one partner and one seed for everyone, the seed read from
 * the first X Layer block of the UTC day (see @lingxi/game daily.ts). The block
 * is kept for the day and shown with a link so anyone can check it. The best
 * result per day stays on this device.
 *
 * Where the block comes from (A34): with the live server, from it (it finds each
 * day's block once), same origin, and checked on mainnet with two reads through
 * the server's door to X Layer; without a server (the on-chain copy), from the
 * public nodes, searched here.
 */

import { create } from "zustand";
import type { PublicClient } from "viem";
import { lazyPublicClient, viem } from "./chainClient";
import { xLayer } from "@lingxi/chain";
import { DAY_MS, dailyPartnerIndex, dailySeed, dayIndex, firstBlockAtOrAfter } from "@lingxi/game";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";
import { API_BASE } from "./apiBase";

const KEY = "lingxi.daily.v1";
const RPCS = ["https://xlayerrpc.okx.com", "https://rpc.xlayer.tech"];
// the live server (an empty VITE_API_URL, as the on-chain copy is built, means none), and whether the game runs on
// mainnet, where the server's door to X Layer reads the same chain the challenge is seeded by
const API = API_BASE;
const ON_MAINNET =
  ((import.meta.env.VITE_CHAIN as string | undefined) || "xlayer") === "xlayer" && !import.meta.env.VITE_RPC;

export interface DailyBlock {
  day: number;
  block: number;
  hash: string;
}

interface Saved {
  block?: DailyBlock;
  /** best outcome per day: hp left on our side minus theirs, and whether it was a win */
  best?: { day: number; margin: number; won: boolean };
}

function read(): Saved {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved) ?? {};
  } catch {
    return {};
  }
}
function write(s: Saved): void {
  try {
    saveWrite(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the challenge still works for this visit
  }
}

/** The server's answer for a day (`services/api/src/daily.ts`). */
export type ServerAnswer = { ok: true; day: number; block: number; hash: string } | { ok: false; reason: string };

/** Where today's block can come from; see the module note. */
export interface DailySources {
  /** the server's answer, or null where there is no server */
  server: ((day: number) => Promise<ServerAnswer>) | null;
  /** a mainnet block read through the server's door, to check its answer; null where the door leads elsewhere */
  check: ((n: number) => Promise<{ timestamp: number; hash: string }>) | null;
  /** the public nodes, searched from here */
  search: (day: number) => Promise<DailyBlock>;
}

function sources(): DailySources {
  // built the first time a block is checked, with viem's client half (P3)
  const door =
    API && ON_MAINNET
      ? lazyPublicClient(
          ({ createPublicClient, http }) =>
            createPublicClient({ chain: xLayer, transport: http(`${API}/api/rpc`, { timeout: 8000 }) }) as PublicClient,
        )
      : null;
  return {
    server: API ? async (day) => (await fetch(`${API}/api/daily/${day}`)).json() as Promise<ServerAnswer> : null,
    check: door
      ? async (n) => {
          const b = await door.getBlock({ blockNumber: BigInt(n) });
          return { timestamp: Number(b.timestamp), hash: b.hash };
        }
      : null,
    search: searchPublicNodes,
  };
}

/** Today's block from the server when there is one (checked where it can be), else from the public nodes. */
export async function findBlock(day: number, from: DailySources = sources()): Promise<DailyBlock> {
  if (!from.server) return from.search(day);
  const a = await from.server(day);
  if (!a.ok) throw new Error(a.reason);
  if (a.day !== day || !Number.isInteger(a.block) || a.block < 1 || !/^0x[0-9a-f]{64}$/.test(a.hash))
    throw new Error("not today's block");
  if (from.check) {
    const midnight = (day * DAY_MS) / 1000;
    const [b, before] = await Promise.all([from.check(a.block), from.check(a.block - 1)]);
    // the block the server named, the first at or after midnight: its own time at or after, the one before it before
    if (b.hash !== a.hash || b.timestamp < midnight || before.timestamp >= midnight)
      throw new Error("not today's block");
  }
  return { day, block: a.block, hash: a.hash };
}

/** The first block of the day, searched from the public nodes (the on-chain copy has no server to ask). */
async function searchPublicNodes(day: number): Promise<DailyBlock> {
  let last: unknown;
  const { createPublicClient, http } = await viem();
  for (const url of RPCS) {
    try {
      const client = createPublicClient({
        chain: { ...xLayer, rpcUrls: { default: { http: [url] } } },
        transport: http(url, { timeout: 8000 }),
      });
      const head = await client.getBlock();
      const blockAt = async (n: number) => Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp);
      const n = await firstBlockAtOrAfter(
        (day * DAY_MS) / 1000,
        { number: Number(head.number), timestamp: Number(head.timestamp) },
        blockAt,
      );
      const b = await client.getBlock({ blockNumber: BigInt(n) });
      return { day, block: n, hash: b.hash };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("X Layer could not be reached");
}

interface DailyState {
  status: "idle" | "loading" | "ready" | "error";
  day: number;
  block: DailyBlock | null;
  seed: number | null;
  partnerIndex: number;
  best: Saved["best"] | null;
  load: () => Promise<void>;
  record: (margin: number, won: boolean) => boolean;
}

export const useDaily = create<DailyState>((set, get) => ({
  status: "idle",
  day: dayIndex(now()),
  block: null,
  seed: null,
  partnerIndex: dailyPartnerIndex(dayIndex(now())),
  best: null,
  load: async () => {
    const day = dayIndex(now());
    const saved = read();
    const best = saved.best?.day === day ? saved.best : null;
    if (saved.block?.day === day) {
      set({
        status: "ready",
        day,
        block: saved.block,
        seed: dailySeed(day, saved.block.hash),
        partnerIndex: dailyPartnerIndex(day),
        best,
      });
      return;
    }
    if (get().status === "loading") return;
    set({ status: "loading", day, partnerIndex: dailyPartnerIndex(day), best });
    try {
      const block = await findBlock(day);
      write({ ...read(), block });
      set({ status: "ready", block, seed: dailySeed(day, block.hash) });
    } catch {
      set({ status: "error" });
    }
  },
  /** Keeps today's best; returns true when this one is a new best. */
  record: (margin, won) => {
    const { day } = get();
    const saved = read();
    const prev = saved.best?.day === day ? saved.best : null;
    if (prev && prev.margin >= margin) return false;
    const best = { day, margin, won };
    write({ ...saved, best });
    set({ best });
    return true;
  },
}));
