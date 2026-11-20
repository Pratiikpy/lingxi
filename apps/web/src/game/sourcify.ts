/**
 * Whether a contract's source is published and matches what runs on X Layer, asked of Sourcify itself (plan 4.13).
 * Every page that says a contract is verified asks here first, so the claim is Sourcify's answer, never fixed text.
 *
 * A71: with a server of its own, the page asks it, and it asks Sourcify (services/api/src/sourcify.ts): an answer from
 * Sourcify without its CORS header, as in an outage, is a console error the browser logs before any code sees it, and
 * through the server it is words on the page instead. The on-chain copy has no server and asks Sourcify directly.
 */

import type { Address } from "viem";

export type SourceState = "exact" | "partial" | "none" | "unreachable";
const STATES: readonly SourceState[] = ["exact", "partial", "none", "unreachable"];
/** The game's own server, when the page has one (the on-chain copy has none). */
const SERVER = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");

/** Sourcify's verdict on one address: an exact match needs both the creation and the runtime bytecode to match. */
export async function sourcifyState(address: Address, signal?: AbortSignal): Promise<SourceState> {
  if (SERVER) {
    try {
      const j = (await (await fetch(`${SERVER}/api/sourcify/${address}`, { signal })).json()) as { ok?: boolean; state?: string };
      return j.ok && STATES.includes(j.state as SourceState) ? (j.state as SourceState) : "unreachable";
    } catch {
      return "unreachable";
    }
  }
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/196/${address}`, { signal });
    if (r.status === 404) return "none";
    if (!r.ok) return "unreachable";
    const d = (await r.json()) as { match?: string | null; creationMatch?: string | null; runtimeMatch?: string | null };
    if (d.creationMatch === "exact_match" && d.runtimeMatch === "exact_match") return "exact";
    return d.match ? "partial" : "none";
  } catch {
    return "unreachable";
  }
}

/** Where anyone can read the source Sourcify holds for an address. */
export const sourcifyPage = (address: string) => `https://repo.sourcify.dev/196/${address}`;
