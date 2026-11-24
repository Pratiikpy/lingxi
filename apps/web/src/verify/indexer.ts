/**
 * Lingxi's indexer: a list of a pet's transactions (hatching, daily saves, new brains). It is a convenience, never a
 * proof: the proof page uses it only to know which transactions to read, then reads each one from X Layer itself.
 * The on-chain copy has no server of its own, so it asks the live site's indexer, which answers any origin.
 */

import { LINGXI_SITE } from "@lingxi/chain/site";

export const INDEXER =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (location.hostname === "localhost" ? "http://localhost:8787" : LINGXI_SITE);

export interface PetHistoryRecord {
  hatched?: { block: number; tx: string; line: number; brainId: string; state: string };
  saves: Array<{ day: number; state: string; logHash: string; block: number; tx: string }>;
  brains: Array<{ brainId: string; bits: number; block: number; tx: string }>;
  parents?: [string, string];
  children: string[];
  at?: Record<string, number>;
}

export async function fetchPetHistory(id: string, signal?: AbortSignal): Promise<PetHistoryRecord | null> {
  const r = await fetch(`${INDEXER}/api/pets/${id}/history`, { signal: signal ?? AbortSignal.timeout(8000) });
  const j = (await r.json()) as { ok: boolean } & PetHistoryRecord;
  return j.ok ? j : null;
}
