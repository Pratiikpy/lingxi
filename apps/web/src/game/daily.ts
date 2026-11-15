/**
 * Today's challenge: one partner and one seed for everyone, the seed read from
 * the first X Layer block of the UTC day (see @lingxi/game daily.ts). The block
 * is found with a few public reads, kept for the day, and shown with a link so
 * anyone can check it. The best result per day stays on this device.
 */

import { create } from "zustand";
import { createPublicClient, http } from "viem";
import { xLayer } from "@lingxi/chain";
import { DAY_MS, dailyPartnerIndex, dailySeed, dayIndex, firstBlockAtOrAfter } from "@lingxi/game";

const KEY = "lingxi.daily.v1";
const RPCS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];

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
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the challenge still works for this visit
  }
}

async function findBlock(day: number): Promise<DailyBlock> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const client = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [url] } } }, transport: http(url, { timeout: 8000 }) });
      const head = await client.getBlock();
      const blockAt = async (n: number) => Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp);
      const n = await firstBlockAtOrAfter((day * DAY_MS) / 1000, { number: Number(head.number), timestamp: Number(head.timestamp) }, blockAt);
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
  day: dayIndex(Date.now()),
  block: null,
  seed: null,
  partnerIndex: dailyPartnerIndex(dayIndex(Date.now())),
  best: null,
  load: async () => {
    const day = dayIndex(Date.now());
    const saved = read();
    const best = saved.best?.day === day ? saved.best : null;
    if (saved.block?.day === day) {
      set({ status: "ready", day, block: saved.block, seed: dailySeed(day, saved.block.hash), partnerIndex: dailyPartnerIndex(day), best });
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
