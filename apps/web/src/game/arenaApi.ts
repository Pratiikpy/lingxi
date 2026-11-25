/**
 * Arena snapshots on the server: save the line this device fielded at a round,
 * and ask for another player's line at the same round. Both are best effort;
 * when the server is slow or has nobody yet, the run meets a ghost team.
 */

import { type DuelPet, shownName } from "@lingxi/game";
import { saveWrite } from "./saveRuntime";
import { arenaOpponentQuery, arenaSnapshotBody, withQuery } from "./requests";

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");
const DEVICE_KEY = "lingxi.device.v1";
const WAIT_MS = 1500;

export interface Rival {
  pet: DuelPet;
  team: string[];
}

/** a random id for this browser, used only so the arena never serves you your own line */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(DEVICE_KEY);
    if (have && /^[0-9a-f]{32}$/.test(have)) return have;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    saveWrite(DEVICE_KEY, id);
    return id;
  } catch {
    return "0".repeat(32);
  }
}

export function saveLine(round: number, pet: DuelPet, team: string[]): void {
  void fetch(`${BASE}/api/arena/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(arenaSnapshotBody(round, pet, team, deviceId())),
    // the arena keeps the last line it received; one that does not arrive leaves that one standing
  }).catch(() => undefined);
}

export async function findRival(round: number): Promise<Rival | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WAIT_MS);
  try {
    const r = await fetch(`${BASE}${withQuery("/api/arena/opponent", arenaOpponentQuery(round, deviceId()))}`, {
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { ok: boolean; pet?: DuelPet; team?: string[] };
    // another player's pet name, shown as every other name from elsewhere is (A144)
    return body.ok && body.pet && Array.isArray(body.team)
      ? { pet: { ...body.pet, name: shownName(body.pet.name, 24) || "Friend" }, team: body.team }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
