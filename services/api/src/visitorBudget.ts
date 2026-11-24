/**
 * The jobs' node, as a fallback for visitors' reads, on a budget (A81). Visitors' reads go first to X Layer's official
 * host the jobs do not use (A52); when that host fails they fall back to the jobs' node, and without a budget a busy
 * minute of visitors would land there and get it throttled, stalling the indexer and the relayer. Past the budget a
 * visitor's read fails at once, as a chain that cannot be read already does, and the jobs' node is never asked.
 */

/** Calls a minute the fallback may make to the jobs' node, for all visitors together. */
export const VISITOR_FALLBACK_PER_MINUTE = 120;

type Request = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** `request`, refusing at once any call past `perMinute` in the last minute. */
export function budgetedRequest(
  request: Request,
  perMinute = VISITOR_FALLBACK_PER_MINUTE,
  now: () => number = Date.now,
): Request {
  let calls: number[] = [];
  return async (args) => {
    const t = now();
    calls = calls.filter((c) => t - c < 60_000);
    if (calls.length >= perMinute) throw new Error("visitor reads past their budget on the jobs' node");
    calls.push(t);
    return request(args);
  };
}
