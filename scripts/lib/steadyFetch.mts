/**
 * Reading the live site from a check (A5). The site is served from one PC through a Cloudflare tunnel, and one request
 * can meet a passing edge or origin error (a 520 when the tunnel drops a reply) while the site is up. Such an answer,
 * or a dropped connection, is tried again a few times, a few seconds apart; any other answer counts at once. Every
 * retry is reported with what came first, so a site that keeps failing still fails, and one that hiccuped says so.
 */

/** Answers from the edge or the origin that say "try again", not "this is wrong". */
export const TRANSIENT = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

export interface SteadyOptions {
  /** tries in all, the first included */
  attempts?: number;
  waitMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
}

/** A response that counts, and what the tries before it got ("520", "timeout"); throws when every try hiccuped. */
export async function steadyFetch(url: string, o: SteadyOptions = {}): Promise<{ res: Response; retried: string[] }> {
  const attempts = o.attempts ?? 4;
  const fetchFn = o.fetchFn ?? ((u: string, init: RequestInit) => fetch(u, init));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retried: string[] = [];
  for (let i = 1; ; i++) {
    let res: Response | null = null;
    let failed: string;
    try {
      res = await fetchFn(url, {
        signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        ...(o.headers ? { headers: o.headers } : {}),
      });
      if (!TRANSIENT.has(res.status)) return { res, retried };
      failed = String(res.status);
    } catch (e) {
      failed =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
          ? "timeout"
          : `no answer (${e instanceof Error ? e.message : String(e)})`;
    }
    if (i >= attempts) throw new Error(`${url}: ${[...retried, failed].join(", then ")}`);
    retried.push(failed);
    await sleep((o.waitMs ?? 3_000) * i);
  }
}

/** "verify.html needed a retry (520)", for a check's line; empty when nothing needed one. */
export const retryNote = (what: string, retried: string[]): string =>
  retried.length
    ? `${what} needed ${retried.length === 1 ? "a retry" : `${retried.length} retries`} (${retried.join(", ")})`
    : "";
