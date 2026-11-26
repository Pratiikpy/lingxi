/**
 * Weekly seasons, client side: enter this week, read any week, and remember
 * which entry is ours (only this device knows its entry key).
 */

import type { DuelPet, SeasonEntry, Standing } from "@lingxi/game";
import { deviceId } from "./arenaApi";
import type { SignedRelay } from "@lingxi/chain";
import { seasonEnterBody } from "./requests";
import { saveWrite } from "./saveRuntime";
import { API_BASE } from "./apiBase";

const BASE = API_BASE;
const KEY = "lingxi.season.v1";

export interface SeasonView {
  week: string;
  closed: boolean;
  ends: number;
  entries: SeasonEntry[];
  standings: Standing[];
  digest: string;
  /** the standings are still being worked out for the newest entries; these are the last known (A38) */
  pending?: true;
  /** the champion's keepsake: its brain taped out on X Layer and sent to its owner */
  award?: { key: string; name: string; brainId?: string; to?: string; sendTx?: string; none?: "noWallet" | "failed" };
}

interface Mine {
  /** week → our entry key */
  keys: Record<string, string>;
  /** weeks whose final place has been turned into a badge */
  awarded: string[];
}

export function mine(): Mine {
  try {
    const raw = localStorage.getItem(KEY);
    const m = raw ? (JSON.parse(raw) as Partial<Mine>) : {};
    return { keys: m.keys ?? {}, awarded: m.awarded ?? [] };
  } catch {
    return { keys: {}, awarded: [] };
  }
}

function keep(m: Mine) {
  try {
    saveWrite(KEY, JSON.stringify(m));
  } catch {
    // private mode: lasts for this visit
  }
}

export function markAwarded(week: string): void {
  const m = mine();
  if (!m.awarded.includes(week)) keep({ ...m, awarded: [...m.awarded, week] });
}

/** Seasons are run by Lingxi's server; the on-chain (DeWEB) build has none and never calls it. */
export const seasonsAvailable = () => BASE !== "";

export async function readSeason(week: string): Promise<SeasonView | null> {
  if (!BASE) return null;
  try {
    const r = await fetch(`${BASE}/api/season/${week}`, { cache: "no-store" });
    const body = (await r.json()) as { ok: boolean } & SeasonView;
    return body.ok ? body : null;
  } catch {
    return null;
  }
}

/** Enters `pet`; with `proof` (signed as the pet on X Layer, see chain.ts signSeasonEntry) it is in line for the keepsake. */
export async function enterSeason(
  pet: DuelPet,
  proof?: SignedRelay<"season">,
): Promise<{ ok: true; week: string; key: string; proven?: boolean } | { ok: false; reason: string; detail?: string }> {
  try {
    const r = await fetch(`${BASE}/api/season/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(seasonEnterBody(pet, deviceId(), proof)),
    });
    const body = (await r.json()) as
      | { ok: true; week: string; key: string; proven?: boolean }
      | { ok: false; reason: string; detail?: string };
    if (body.ok) {
      const m = mine();
      keep({ ...m, keys: { ...m.keys, [body.week]: body.key } });
    }
    return body;
  } catch {
    return { ok: false, reason: "offline" };
  }
}
