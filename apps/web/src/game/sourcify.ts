/**
 * Whether a contract's source is published and matches what runs on X Layer, asked of Sourcify itself (plan 4.13).
 * Every page that says a contract is verified asks here first, so the claim is Sourcify's answer, never fixed text.
 */

import type { Address } from "viem";

export type SourceState = "exact" | "partial" | "none" | "unreachable";

/** Sourcify's verdict on one address: an exact match needs both the creation and the runtime bytecode to match. */
export async function sourcifyState(address: Address, signal?: AbortSignal): Promise<SourceState> {
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
