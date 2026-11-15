/**
 * Weekly seasons, client side: enter this week, read any week, and remember
 * which entry is ours (only this device knows its entry key).
 */

import type { DuelPet, SeasonEntry, Standing } from "@lingxi/game";
import { deviceId } from "./arenaApi";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const KEY = "lingxi.season.v1";

export interface SeasonView {
  week: string;
  closed: boolean;
  ends: number;
  entries: SeasonEntry[];
  standings: Standing[];
  digest: string;
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
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // private mode: lasts for this visit
  }
}

export function markAwarded(week: string): void {
  const m = mine();
  if (!m.awarded.includes(week)) keep({ ...m, awarded: [...m.awarded, week] });
}

export async function readSeason(week: string): Promise<SeasonView | null> {
  try {
    const r = await fetch(`${BASE}/api/season/${week}`, { cache: "no-store" });
    const body = (await r.json()) as { ok: boolean } & SeasonView;
    return body.ok ? body : null;
  } catch {
    return null;
  }
}

export async function enterSeason(pet: DuelPet, wallet?: string): Promise<{ ok: true; week: string; key: string } | { ok: false; reason: string }> {
  try {
    const r = await fetch(`${BASE}/api/season/enter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pet, device: deviceId(), ...(wallet ? { wallet } : {}) }) });
    const body = (await r.json()) as { ok: true; week: string; key: string } | { ok: false; reason: string };
    if (body.ok) {
      const m = mine();
      keep({ ...m, keys: { ...m.keys, [body.week]: body.key } });
    }
    return body;
  } catch {
    return { ok: false, reason: "offline" };
  }
}
