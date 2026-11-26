/**
 * Finding a holder's TapeCode-Test1 without a typed number (H9). The server's index says which tokens it saw the wallet
 * hold (one request); the game confirms each on chain before offering it, and reads every owner itself when the hint
 * is missing or does not account for every token the wallet holds (see `test1TokensOf`).
 */
import type { Test1Lookup } from "@lingxi/chain";
import { API_RPC } from "./chain";
import { API_BASE } from "./apiBase";

const BASE = API_BASE;

/**
 * Owners per multicall when the game reads them itself: through the server's door (`/api/rpc`, which takes requests up
 * to 64 KB) a call of 120 owners is about 54 KB; straight to a public node (the on-chain copy) a thousand fit.
 */
export const TEST1_PER_CALL = API_RPC ? 120 : 1000;

/** The lookup to pass to `giftWaysOf`: the index's hint when the server answers, and the batch size for this door. */
export async function test1Lookup(wallet: string, fetchFn: typeof fetch = fetch): Promise<Test1Lookup> {
  const lookup: Test1Lookup = { perCall: TEST1_PER_CALL };
  if (!BASE) return lookup;
  try {
    const r = await fetchFn(`${BASE}/api/holders/test1/${wallet}`);
    const body = (await r.json()) as { ok?: boolean; tokens?: unknown };
    if (
      body.ok !== true ||
      !Array.isArray(body.tokens) ||
      !body.tokens.every((x) => typeof x === "string" && /^\d{1,6}$/.test(x))
    )
      return lookup;
    return { ...lookup, candidates: (body.tokens as string[]).map((x) => BigInt(x)) };
  } catch {
    return lookup;
  }
}
