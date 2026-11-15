/**
 * Pet-sitting across two devices (PRD C10, M2). The owner sends the pet to a
 * friend by link; the owner's own copy waits, frozen, until it comes home. The
 * friend cares for it (and may save it on chain with their own wallet when the
 * owner named them sitter there), then sends it home. The owner's game accepts
 * the return only if every thought it had away extends the owner's own log,
 * the hash chain matches, and replaying those thoughts reproduces its memory
 * (see @lingxi/game sitting.ts); if it was saved on chain meanwhile, the saved
 * log hash must match too.
 */

import { type Pet, type SitPack, ZERO_HASH, chainAll, checkReturn } from "@lingxi/game";
import { readPet } from "@lingxi/chain";
import { linkPrefix } from "./links";
import { brainOf, useGame } from "./store";
import { type ChainRecord, deployment, publicClient, recordOf, setRecordOf } from "./chain";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
export const sittingAvailable = () => BASE !== "";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
async function keyHash(key: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lingxi-sit:${key}`))));
}

/** What travels home with the pet: the pet, and how far its on-chain saves reached while away. */
interface Homecoming {
  pet: Pet;
  chain?: { lastDay: number; logLen: number } | null;
}

/** Owner: send the pet to a friend. Returns the link to give them. */
export async function sendToSitter(pet: Pet, days: number): Promise<string> {
  const key = hex(crypto.getRandomValues(new Uint8Array(16)));
  const until = Date.now() + Math.round(days) * 86_400_000;
  const record = recordOf(pet);
  const pack: SitPack = {
    v: 1,
    pet,
    chain: record ? { petId: record.petId, owner: record.owner, bornChain: record.bornChain, brains: record.brains, brainKey: record.brainKey, lastDay: record.lastDay } : null,
    sitter: record?.sitter && record.sitter.until * 1000 > Date.now() ? record.sitter.who : null,
    until,
  };
  const r = await fetch(`${BASE}/api/sit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pack: JSON.stringify(pack), keyHash: await keyHash(key), until }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { ok: boolean; code?: string; reason?: string };
  if (!j.ok || !j.code) throw new Error(j.reason ?? "failed");
  useGame.getState().replace({ ...pet, away: { code: j.code, key, until, sitter: pack.sitter } });
  return sitLink(j.code, key);
}

export const sitLink = (code: string, key: string) => `${linkPrefix("play.html")}sit=${code}.${key}`;

/** Owner: has the pet come home? Accepts it only after the checks. */
export async function checkHome(pet: Pet): Promise<"waiting" | "home" | "refused" | "unreachable"> {
  if (!pet.away) return "home";
  let j: { ok: boolean; back?: string };
  try {
    j = (await (await fetch(`${BASE}/api/sit/${pet.away.code}`, { signal: AbortSignal.timeout(10000) })).json()) as typeof j;
  } catch {
    return "unreachable";
  }
  if (!j.ok || !j.back) return "waiting";
  let back: Homecoming;
  try {
    back = JSON.parse(j.back) as Homecoming;
  } catch {
    return "refused";
  }
  const { away: _away, ...home } = pet;
  const { sitting: _s, ...returned } = back.pet;
  const check = checkReturn(home as Pet, returned as Pet, brainOf(home as Pet));
  if (!check.ok) return "refused";
  // anything the sitter saved on chain must be this same log
  const record = recordOf(pet);
  if (record && back.chain && deployment) {
    try {
      const onChain = await readPet(publicClient, deployment, BigInt(record.petId));
      if (onChain.day > record.lastDay) {
        if (chainAll(ZERO_HASH, returned.pendingLog.slice(0, back.chain.logLen)) !== onChain.logHash) return "refused";
        setRecordOf(pet, { ...record, lastDay: onChain.day, logLen: back.chain.logLen } as ChainRecord);
      }
    } catch {
      return "unreachable";
    }
  }
  useGame.getState().replace(returned as Pet);
  return "home";
}

/** Owner: stop waiting. The pet's own copy carries on from where it left; a return that already arrived is taken first. */
export async function bringHomeNow(pet: Pet): Promise<"home" | "ownCopy"> {
  const r = await checkHome(pet);
  if (r === "home") return "home";
  const { away: _away, ...home } = pet;
  useGame.getState().replace(home as Pet);
  return "ownCopy";
}

/** Friend: read a pack from a link. */
export async function collect(code: string): Promise<SitPack | null> {
  try {
    const j = (await (await fetch(`${BASE}/api/sit/${code}`, { signal: AbortSignal.timeout(10000) })).json()) as { ok: boolean; pack?: string };
    if (!j.ok || !j.pack) return null;
    const p = JSON.parse(j.pack) as SitPack;
    return p.v === 1 && p.pet && typeof p.pet.bornAt === "number" ? p : null;
  } catch {
    return null;
  }
}

/** Friend: take the pet in. */
export function takeIn(pack: SitPack, code: string, key: string): boolean {
  const { away: _away, ...pet } = pack.pet;
  const guest: Pet = { ...(pet as Pet), sitting: { code, key, until: pack.until, owner: pack.chain?.owner ?? null, name: pack.pet.name } };
  if (!useGame.getState().guest(guest)) return false;
  if (pack.chain) setRecordOf(guest, { petId: pack.chain.petId, hatchTx: "", lastDay: pack.chain.lastDay, owner: pack.chain.owner, bornChain: pack.chain.bornChain, brains: pack.chain.brains, brainKey: pack.chain.brainKey });
  return true;
}

/** Friend: send the pet home. It leaves this device once it has been delivered. */
export async function sendHome(given: Pet): Promise<boolean> {
  // the very latest state, not the one on screen a beat ago
  const live = useGame.getState().pet;
  const pet = live && live.bornAt === given.bornAt ? live : given;
  if (!pet.sitting) return false;
  const record = recordOf(pet);
  const { sitting, ...home } = pet;
  const body: Homecoming = { pet: home as Pet, chain: record && record.logLen !== undefined ? { lastDay: record.lastDay, logLen: record.logLen } : null };
  const r = await fetch(`${BASE}/api/sit/${sitting.code}/home`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: sitting.key, pet: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { ok: boolean };
  if (!j.ok) return false;
  setRecordOf(pet, null);
  useGame.getState().release(pet.bornAt);
  return true;
}
