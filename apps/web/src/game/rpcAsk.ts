import { now as gameNow } from "./gameClock";
/**
 * One JSON-RPC request for a verification, tried endpoint by endpoint: the judge's own RPC first, then X Layer's public
 * RPCs (paced), and Lingxi's server only when every one of those failed. The answer says which host gave it.
 * Pure: no browser state, so it is tested on its own (rpcAsk.test.ts).
 */

export interface Endpoints {
  /** the judge's own RPC, asked first */
  mine: string | null;
  /** X Layer's public RPCs, in the order to ask */
  publicRpcs: readonly string[];
  /** Lingxi's server, only when every one above failed */
  fallback: string | null;
}

export interface Answer {
  result: unknown;
  host: string;
  fallback: boolean;
}

/** A JSON-RPC error from a node that did answer (a revert, a bad request): passed back, never retried elsewhere. */
export class RpcAnswerError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;
/** At most one request starting per host in this window, so a full check stays inside the public nodes' limits. */
const GAP_MS = 45;
const lastStart = new Map<string, number>();
const hostOf = (url: string) => new URL(url).host;

async function paced(url: string): Promise<void> {
  const host = hostOf(url);
  const now = gameNow();
  const at = Math.max(now, (lastStart.get(host) ?? 0) + GAP_MS);
  lastStart.set(host, at);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const RATE_LIMITED = /rate|limit|too many|capacity|busy/i;

/** One JSON-RPC request, tried endpoint by endpoint as described above. */
export async function proofRequest(ends: Endpoints, call: { method: string; params?: unknown }, opts: { fetcher?: typeof fetch } = {}): Promise<Answer> {
  const fetcher = opts.fetcher ?? fetch;
  const order = [...(ends.mine ? [ends.mine] : []), ...ends.publicRpcs];
  const tries = [...order.map((url) => ({ url, fallback: false })), ...(ends.fallback ? [{ url: ends.fallback, fallback: true }] : [])];
  for (const { url, fallback } of tries) {
    if (!opts.fetcher) await paced(url);
    let res: Response;
    try {
      res = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: call.method, params: call.params ?? [] }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    let body: { result?: unknown; error?: { code: number; message: string; data?: unknown } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      continue;
    }
    if (body.error) {
      if (body.error.code === -32005 || body.error.code === 429 || RATE_LIMITED.test(body.error.message)) continue;
      throw new RpcAnswerError(body.error.message, body.error.code, body.error.data);
    }
    return { result: body.result, host: hostOf(url), fallback };
  }
  throw new Error(`no endpoint answered ${call.method}`);
}
