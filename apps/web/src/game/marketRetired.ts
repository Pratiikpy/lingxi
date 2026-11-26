/**
 * A23: the game never shows or buys an OKB-market (OutfitMarket V1) listing that a sale retired. V1 does not retire a
 * seller's other listings when one sells, so such a listing comes back at its old price once the seller holds a copy
 * again, and the chain would sell it. The server watches V1's events and says which listings V2's rule would have
 * retired (`/api/market/retired`); without that answer the game shows no V1 listing to buy.
 */
import type { OutfitListing } from "@lingxi/chain";
import { API_BASE } from "./apiBase";

const BASE = API_BASE;

/**
 * The OKB-market listings the server says a sale retired, or null when it cannot say: no server (the on-chain copy),
 * the server unreachable, or its watch not yet caught up with the chain.
 */
export async function retiredOkbListings(fetchFn: typeof fetch = fetch): Promise<Set<string> | null> {
  try {
    const r = await fetchFn(`${BASE}/api/market/retired`);
    if (!r.ok) return null;
    const body = (await r.json()) as { ready?: unknown; retired?: unknown };
    if (body.ready !== true || !Array.isArray(body.retired) || !body.retired.every((x) => typeof x === "string"))
      return null;
    return new Set(body.retired as string[]);
  } catch {
    return null;
  }
}

/**
 * The listings the market shows: every BEM-market listing; an OKB-market listing only when the server says no sale
 * retired it, and, when it cannot say, only the player's own, so they can still cancel it.
 */
export function shownListings(
  listings: readonly OutfitListing[],
  retired: ReadonlySet<string> | null,
  who: string | null,
): OutfitListing[] {
  return listings.filter(
    (l) =>
      l.market !== 1 ||
      (retired ? !retired.has(l.id.toString()) : !!who && l.seller.toLowerCase() === who.toLowerCase()),
  );
}
