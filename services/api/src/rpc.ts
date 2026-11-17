/**
 * A same-origin door to X Layer for the browser. The public RPCs answer a burst of reads with rate-limit replies
 * that carry no CORS headers, which the browser reports as blocked requests and the game as a failed read. The
 * game therefore sends its JSON-RPC through here: the server forwards each request to the first upstream that
 * answers, and the browser only ever talks to its own origin. Only the read methods the game uses and the one
 * write it makes (a signed, raw transaction) pass; everything else is refused before reaching an upstream.
 */

import type { Context, Hono } from "hono";
import { RateLimiter } from "./limit";

export const RPC_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_call",
  "eth_getLogs",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_sendRawTransaction",
  "net_version",
]);
export const RPC_BODY_MAX = 128_000;

interface Call {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface RpcProxyOptions {
  upstreams: string[];
  limiter?: RateLimiter;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const refusal = (c: Call, code: number, message: string) => ({ jsonrpc: "2.0", id: c.id ?? null, error: { code, message } });

/** Which calls in a body are allowed; null when the body is not JSON-RPC at all. */
export function vetCalls(body: unknown): { calls: Call[]; batch: boolean; refused: Record<string, unknown>[] } | null {
  const batch = Array.isArray(body);
  const list = (batch ? body : [body]) as unknown[];
  if (list.length === 0 || list.length > 100) return null;
  const calls: Call[] = [];
  const refused: Record<string, unknown>[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const c = item as Call;
    if (typeof c.method !== "string") return null;
    if (!RPC_METHODS.has(c.method)) refused.push(refusal(c, -32601, `method not allowed here: ${c.method}`));
    else calls.push(c);
  }
  return { calls, batch, refused };
}

export function withRpcProxy(app: Hono, opts: RpcProxyOptions) {
  const limiter = opts.limiter ?? new RateLimiter(600, 60_000);
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const who = (c: Context) => c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  app.post("/api/rpc", async (c) => {
    if (!limiter.take(who(c))) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "too many requests" } }, 429);
    const text = await c.req.text();
    if (text.length > RPC_BODY_MAX) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }
    const vetted = vetCalls(body);
    if (!vetted) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } }, 400);
    const { calls, batch, refused } = vetted;
    let answers: unknown[] = [];
    if (calls.length) {
      const forwarded = await forward(calls, opts.upstreams, doFetch, timeoutMs);
      if (!forwarded) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "no upstream answered" } }, 502);
      answers = forwarded;
    }
    const all = [...answers, ...refused];
    return c.json(batch ? all : (all[0] ?? { jsonrpc: "2.0", id: null, error: { code: -32603, message: "empty" } }));
  });
}

/** Sends the calls to each upstream in turn; the first well-formed JSON answer wins. */
async function forward(calls: Call[], upstreams: string[], doFetch: typeof fetch, timeoutMs: number): Promise<unknown[] | null> {
  const payload = JSON.stringify(calls.length === 1 ? calls[0] : calls);
  for (const url of upstreams) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: ctl.signal });
      if (!r.ok) continue;
      const parsed = (await r.json()) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      // the next upstream gets its turn
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
