/**
 * Sourcify's verdict on the deployment's contracts, relayed (A71). The proof page and the Extras sheet say whether each
 * contract's source is verified, and that has to be Sourcify's answer, never fixed text. Asked from the browser, an
 * answer from Sourcify without its CORS header (an outage did this) is logged by the browser as a console error before
 * any page code sees it, and no page code can stop that. Asked here, the page talks only to its own server: an outage
 * reaches it as words ("Sourcify unreachable"), and every row still links to Sourcify's own page to check.
 *
 * Only the deployment's own contracts are asked about, so the server is never an open proxy. Answers are kept ten
 * minutes and failures one, and one question per address is in flight at a time, however many pages ask.
 */

import type { Hono } from "hono";
import { RateLimiter } from "./limit";
import { clientIp } from "./clientIp";

export type SourceState = "exact" | "partial" | "none" | "unreachable";

const ANSWER_MS = 10 * 60_000;
const FAILURE_MS = 60_000;
const TIMEOUT_MS = 8_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface SourcifyRelayOptions {
  /** the addresses that may be asked about: the deployment's own */
  allowed: Iterable<string>;
  /** Sourcify's server, up to and without `/v2` */
  base?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** Sourcify's v2 answer as the page words it: an exact match needs both the creation and the runtime bytecode. */
async function verdict(r: Response): Promise<SourceState> {
  if (r.status === 404) return "none";
  if (!r.ok) return "unreachable";
  try {
    const d = (await r.json()) as {
      match?: string | null;
      creationMatch?: string | null;
      runtimeMatch?: string | null;
    };
    if (d.creationMatch === "exact_match" && d.runtimeMatch === "exact_match") return "exact";
    return d.match ? "partial" : "none";
  } catch {
    return "unreachable";
  }
}

export function createSourcifyRelay(opts: SourcifyRelayOptions) {
  const allowed = new Set([...opts.allowed].map((a) => a.toLowerCase()));
  const base = (opts.base ?? "https://sourcify.dev/server").replace(/\/$/, "");
  const fetcher = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const kept = new Map<string, { state: SourceState; until: number }>();
  const asking = new Map<string, Promise<SourceState>>();

  const ask = async (address: string): Promise<SourceState> => {
    try {
      const r = await Promise.race([
        fetcher(`${base}/v2/contract/196/${address}`, { signal: AbortSignal.timeout(timeoutMs) }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("time limit")), timeoutMs).unref?.()),
      ]);
      return await verdict(r);
    } catch {
      return "unreachable";
    }
  };

  return {
    /** Sourcify's verdict on `address`, or null for an address not in the deployment. */
    async state(address: string): Promise<SourceState | null> {
      const a = address.toLowerCase();
      if (!allowed.has(a)) return null;
      const held = kept.get(a);
      if (held && now() < held.until) return held.state;
      let flight = asking.get(a);
      if (!flight) {
        flight = ask(a).then((state) => {
          kept.set(a, { state, until: now() + (state === "unreachable" ? FAILURE_MS : ANSWER_MS) });
          asking.delete(a);
          return state;
        });
        asking.set(a, flight);
      }
      return flight;
    },
  };
}
export type SourcifyRelay = ReturnType<typeof createSourcifyRelay>;

/** GET /api/sourcify/:address — Sourcify's verdict on one of the deployment's contracts. */
export function withSourcify(app: Hono, relay: SourcifyRelay, limiter = new RateLimiter(120, 60_000)): Hono {
  app.get("/api/sourcify/:address", async (c) => {
    const address = c.req.param("address");
    if (!ADDRESS.test(address)) return c.json({ ok: false, reason: "invalid" }, 400);
    // a page asks about a dozen contracts at once; more than this from one address is not a page
    if (!limiter.take(clientIp(c))) return c.json({ ok: true, address: address.toLowerCase(), state: "unreachable" });
    const state = await relay.state(address);
    if (state === null) return c.json({ ok: false, reason: "unknown" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, address: address.toLowerCase(), state });
  });
  return app;
}
