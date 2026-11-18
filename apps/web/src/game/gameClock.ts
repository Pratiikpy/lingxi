/**
 * The game's one clock, as the pages use it (clock.ts holds the rules). Everything the game times (a pet's beats, a
 * day's rewards, a shift's pay, a sitting's end) reads `now()`, never the device clock directly. The time it trusts is
 * the game server's; the on-chain copy, which has no server, takes the time of X Layer's latest block instead.
 */

import { createClock } from "./clock";
import { saveWrite } from "./saveRuntime";
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

const storage = (() => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
})();

export const clock = createClock({
  wall: () => Date.now(),
  mono: () => performance.now(),
  storage: { getItem: (k) => storage?.getItem(k) ?? null },
  write: (k, v) => void saveWrite(k, v),
  serverTime: BASE ? serverClock : chainClock,
});

/** The game's time now, in milliseconds since the epoch. */
export const now = (): number => clock.now();

let started = false;
/**
 * Asks the server for the time now, again every half hour and whenever the page comes back into view (after a device
 * slept, say). Resolves once the first answer is in, or after a moment without one: the game never waits long.
 */
export function startClock(): Promise<void> {
  if (!started) {
    started = true;
    setInterval(() => void clock.sync(), SYNC_EVERY_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void clock.sync();
    });
  }
  return Promise.race([clock.sync().then(() => undefined), new Promise<void>((r) => setTimeout(r, FIRST_ANSWER_MS))]);
}
