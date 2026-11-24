/**
 * A same-origin door to X Layer for the browser. The public RPCs answer a burst of reads with rate-limit replies
 * that carry no CORS headers, which the browser reports as blocked requests and the game as a failed read. The
 * game therefore sends its JSON-RPC through here: the server forwards each request to the first upstream that
 * answers, and the browser only ever talks to its own origin. Only the read methods the game uses and the one
 * write it makes (a signed, raw transaction) pass; everything else is refused before reaching an upstream.
 *
 * What one visitor, or a crowd of them, can ask is bounded: batches of at most MAX_BATCH calls, each call counted
 * against the caller and against a ceiling for everyone together; logs only over at most MAX_LOG_BLOCKS stated
 * blocks. The door forwards to its own upstreams, not the one the server's jobs read from (the relayer, the
 * indexer, the goals), so traffic through the door can never get the jobs' upstream to throttle us; that one is
 * only a small last reserve.
 */

import type { Context, Hono } from "hono";
import { FairCeiling, RateLimiter } from "./limit";
import { clientIp } from "./clientIp";

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
/** Calls one request may batch. */
export const MAX_BATCH = 10;
/** Blocks one eth_getLogs may span (the public X Layer nodes allow 100). */
export const MAX_LOG_BLOCKS = 100;
const BLOCK_NUMBER = /^0x[0-9a-fA-F]{1,16}$/;
const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;

interface Call {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface RpcProxyOptions {
  /** the door's own upstreams, tried in turn */
  upstreams: string[];
  /** the server jobs' upstream: tried last, and only this many calls a minute */
  reserve?: { url: string; perMinute: number };
  /** calls per caller */
  limiter?: RateLimiter;
  /** calls for everyone together, shared fairly among the callers asking (A83) */
  global?: FairCeiling;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const refusal = (c: Call, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: c.id ?? null,
  error: { code, message },
});

/**
 * Whether a log filter spans a short, stated range: a block hash, no range at all (the latest block), or two block
 * numbers at most MAX_LOG_BLOCKS apart. A tag such as "earliest" or "latest" at one end leaves the span unknown.
 */
export function shortLogRange(params: unknown): boolean {
  const f = Array.isArray(params) ? params[0] : undefined;
  if (!f || typeof f !== "object") return false;
  const { blockHash, fromBlock, toBlock } = f as Record<string, unknown>;
  if (blockHash !== undefined)
    return (
      typeof blockHash === "string" && BLOCK_HASH.test(blockHash) && fromBlock === undefined && toBlock === undefined
    );
  if (fromBlock === undefined && toBlock === undefined) return true;
  if (
    typeof fromBlock !== "string" ||
    typeof toBlock !== "string" ||
    !BLOCK_NUMBER.test(fromBlock) ||
    !BLOCK_NUMBER.test(toBlock)
  )
    return false;
  const span = BigInt(toBlock) - BigInt(fromBlock);
  return span >= 0n && span < BigInt(MAX_LOG_BLOCKS);
}

/** Which calls in a body are allowed; null when the body is not JSON-RPC at all, or batches more than MAX_BATCH. */
export function vetCalls(body: unknown): { calls: Call[]; batch: boolean; refused: Record<string, unknown>[] } | null {
  const batch = Array.isArray(body);
  const list = (batch ? body : [body]) as unknown[];
  if (list.length === 0 || list.length > MAX_BATCH) return null;
  const calls: Call[] = [];
  const refused: Record<string, unknown>[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const c = item as Call;
    if (typeof c.method !== "string") return null;
    if (!RPC_METHODS.has(c.method)) refused.push(refusal(c, -32601, `method not allowed here: ${c.method}`));
    else if (c.method === "eth_getLogs" && !shortLogRange(c.params))
      refused.push(
        refusal(
          c,
          -32602,
          `logs over at most ${MAX_LOG_BLOCKS} blocks: give fromBlock and toBlock as block numbers, or a blockHash`,
        ),
      );
    else calls.push(c);
  }
  return { calls, batch, refused };
}

export function withRpcProxy(app: Hono, opts: RpcProxyOptions) {
  const limiter = opts.limiter ?? new RateLimiter(600, 60_000);
  const global = opts.global ?? new FairCeiling(1_800, 60_000);
  const reserve = opts.reserve
    ? { url: opts.reserve.url, limiter: new RateLimiter(opts.reserve.perMinute, 60_000) }
    : null;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const who = (c: Context) => clientIp(c);

  app.post("/api/rpc", async (c) => {
    const busy = () => c.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "too many requests" } }, 429);
    if (!limiter.take(who(c))) return busy();
    const text = await c.req.text();
    if (text.length > RPC_BODY_MAX)
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }
    const vetted = vetCalls(body);
    if (!vetted) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } }, 400);
    const { calls, batch, refused } = vetted;
    // every call in a batch counts, for the caller (the first was taken above) and for everyone together
    for (let i = 1; i < calls.length; i++) if (!limiter.take(who(c))) return busy();
    // the ceiling is shared: a caller past its share of it waits while others are served (A83)
    for (let i = 0; i < calls.length; i++) if (!global.take(who(c))) return busy();
    let answers: unknown[] = [];
    if (calls.length) {
      let forwarded = await forward(calls, opts.upstreams, doFetch, timeoutMs);
      // the jobs' upstream only when the door's own failed, and only within its small budget
      if (!forwarded && reserve?.limiter.take("all"))
        forwarded = await forward(calls, [reserve.url], doFetch, timeoutMs);
      if (!forwarded)
        return c.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "no upstream answered" } }, 502);
      answers = forwarded;
    }
    const all = [...answers, ...refused];
    return c.json(batch ? all : (all[0] ?? { jsonrpc: "2.0", id: null, error: { code: -32603, message: "empty" } }));
  });
}

/** Sends the calls to each upstream in turn; the first well-formed JSON answer wins. */
async function forward(
  calls: Call[],
  upstreams: string[],
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<unknown[] | null> {
  const payload = JSON.stringify(calls.length === 1 ? calls[0] : calls);
  for (const url of upstreams) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: ctl.signal,
      });
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
