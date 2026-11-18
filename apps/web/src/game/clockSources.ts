/**
 * Where a page's clock gets its time, and how it keeps asking (clock.ts holds the rules). The game and the browser
 * handheld each run a clock from here, so both live by the same time: the game server's, or on the on-chain copy,
 * which has no server, the time of X Layer's latest block.
 */

import type { Clock } from "./clock";
import { OFFICIAL_RPCS } from "./nodes";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (typeof location !== "undefined" && location.hostname === "localhost" ? "http://localhost:8787" : "");
const RPC = (import.meta.env.VITE_RPC as string | undefined) || null;

/** The game server's time. */
async function serverClock(): Promise<number> {
  const r = await fetch(`${BASE}/api/time`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  return Number(((await r.json()) as { now?: unknown }).now);
}

/** The time of X Layer's latest block, from the nodes the game reads (a block is seconds old at most). */
async function chainClock(): Promise<number> {
  let last: unknown = new Error("no node answered");
  for (const url of RPC ? [RPC] : OFFICIAL_RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const seconds = Number.parseInt(((await r.json()) as { result?: { timestamp?: string } }).result?.timestamp ?? "", 16);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
/** How often the server is asked again while the page is open. */
const SYNC_EVERY_MS = 30 * 60_000;
/** How long the game waits for the server's first answer before it starts on the device's time. */
const FIRST_ANSWER_MS = 1_500;

/** The time the game trusts, from the server when there is one, else from X Layer's latest block. */
export const serverTime: () => Promise<number> = BASE ? serverClock : chainClock;

/** The clock state the game saved last, read by any page; storage may be blocked (some private modes). */
export const savedClock = {
  getItem: (k: string): string | null => {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null;
    } catch {
      return null;
    }
  },
};

/**
 * Starts keeping `clock` in time: asks the server now, again every half hour and whenever the page comes back into
 * view (after a device slept, say). The returned function starts it once and resolves once the first answer is in, or
 * after a moment without one: a page never waits long.
 */
export function keepInTime(clock: Clock): () => Promise<void> {
  let first: Promise<void> | null = null;
  return () =>
    (first ??= (() => {
      setInterval(() => void clock.sync(), SYNC_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void clock.sync();
      });
      return Promise.race([clock.sync().then(() => undefined), new Promise<void>((r) => setTimeout(r, FIRST_ANSWER_MS))]);
    })());
}

