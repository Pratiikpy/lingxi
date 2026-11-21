/**
 * The gate in front of the brain relayer, which spends Lingxi's OKB. A request passes only if it is signed, fresh and
 * new by a key that may keep the pet on chain (see `@lingxi/chain`'s relayAuth.ts), and only within quotas per pet,
 * per signer and for everyone each hour, first to pets with standing on chain (A40). The relayer itself adds a daily ceiling, an hourly ceiling and a reserve
 * kept for season keepsakes.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Address, type Hex, isAddress, recoverMessageAddress } from "viem";
import { type RelayKind, relayMessage } from "@lingxi/chain";
import { hasStore, readStore, saveJson } from "./durable";

const WINDOW_S = 5 * 60;
const NONCE = /^[0-9a-f]{16,64}$/;
const PET = /^\d{1,20}$/;
const MAX_PAYLOAD = 20_000;

export type RelayRefusal = "unsigned" | "expired" | "replayed" | "badSignature" | "notKeeper" | "busy";

/**
 * A relay request as it arrives (a relay route's envelope, or a season entry's proof). Nothing in it is trusted yet:
 * `checkRelayAuth` reads the signer as an address and the signature as one only after checking that they are.
 */
export interface RelayRequest {
  kind: RelayKind;
  petId: string;
  payload: string;
  auth: { signer: string; nonce: string; time: number; signature: string };
}

const isSignature = (s: string): s is Hex => /^0x[0-9a-fA-F]{130}$/.test(s);

/** Nonces seen in the last window, so a signature is used once. */
export function createNonceBook(cap = 100_000) {
  const seen = new Map<string, number>();
  return {
    /** Records `nonce` until `until` (ms); false if it was already used or the book is full. */
    use(nonce: string, until: number, now: number): boolean | "full" {
      if (seen.size >= cap) for (const [n, t] of seen) if (t < now) seen.delete(n);
      if (seen.size >= cap) return "full";
      if (seen.has(nonce)) return false;
      seen.set(nonce, until);
      return true;
    },
  };
}
export type NonceBook = ReturnType<typeof createNonceBook>;

export async function checkRelayAuth(
  req: RelayRequest,
  deps: { isKeeper: (petId: string, who: Address) => Promise<boolean>; now: () => number; nonces: NonceBook },
): Promise<{ ok: true; signer: Address } | { ok: false; reason: RelayRefusal }> {
  const a = req.auth;
  if (!a || !PET.test(req.petId) || typeof req.payload !== "string" || req.payload.length > MAX_PAYLOAD || !isAddress(a.signer) || !NONCE.test(a.nonce) || !Number.isInteger(a.time) || !isSignature(a.signature)) return { ok: false, reason: "unsigned" };
  const now = deps.now();
  if (Math.abs(now / 1000 - a.time) > WINDOW_S) return { ok: false, reason: "expired" };
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: relayMessage({ kind: req.kind, petId: req.petId, payload: req.payload, nonce: a.nonce, time: a.time }), signature: a.signature });
  } catch {
    return { ok: false, reason: "badSignature" };
  }
  if (signer.toLowerCase() !== a.signer.toLowerCase()) return { ok: false, reason: "badSignature" };
  if (!(await deps.isKeeper(req.petId, signer).catch(() => false))) return { ok: false, reason: "notKeeper" };
  // the nonce is spent only by a request that would otherwise go through
  const fresh = deps.nonces.use(`${signer.toLowerCase()}:${a.nonce}`, (a.time + WINDOW_S) * 1000, now);
  if (fresh === "full") return { ok: false, reason: "busy" };
  if (!fresh) return { ok: false, reason: "replayed" };
  return { ok: true, signer };
}

/** The caps on Lingxi's sponsored tape-outs (A40). */
export interface SponsorCaps {
  perPetPerDay: number;
  perSignerPerDay: number;
  perHour: number;
  /** the relayer's own daily ceiling, of which newcomers may draw their share */
  perDay?: number;
  /** the share of each hour and each day a pet not yet settled on chain may draw */
  newcomerShare?: number;
  /** sponsored tape-outs a pet may have in all: before it settles, and over its life */
  lifetime?: { newcomer: number; settled: number };
  /** settled pets' tape-outs one signer may draw each hour (A142) */
  settledPerSignerPerHour?: number;
  /** the share of each hour kept for pets not yet served today (A142) */
  keptForUnserved?: number;
}

/** Slots taken for the tape-outs one request may send, given back with `refund` for those it did not send. */
export interface SponsorTicket {
  petId: string;
  signer: string;
  at: number;
  settled: boolean;
  day: string;
  /** how many slots it holds (A75: a taught child's halves and glue are three tape-outs) */
  n: number;
}

/**
 * Lingxi's sponsored tape-outs: per pet and per signer each day, for everyone each hour, and (A40) first to pets with
 * standing on chain. A pet not yet settled (PetRegistry.isSettled: three days and its third day saved) draws only the
 * newcomers' share of each hour and day, and only so many in all before it settles; a settled pet so many over its
 * life. A slot is taken before the tape-out and given back only if nothing was sent, so no burst can pass a cap. The
 * lifetime counts are kept in `file`.
 */
export class RelayQuota {
  private day = "";
  private perPet = new Map<string, number>();
  private perSigner = new Map<string, number>();
  private hour: Array<{ at: number; settled: boolean; signer: string }> = [];
  private newcomersToday = 0;
  /** every sponsored tape-out today, settled or not: the relayer's day holds for all (A142) */
  private allToday = 0;
  private lifetime = new Map<string, number>();

  constructor(
    private readonly caps: SponsorCaps,
    private readonly file?: string,
  ) {
    if (file && hasStore(file)) {
      try {
        for (const [pet, n] of Object.entries(readStore(file) as Record<string, number>)) if (PET.test(pet) && Number.isInteger(n) && n > 0) this.lifetime.set(pet, n);
      } catch {
        // an unreadable file starts from nothing; the daily and hourly caps still hold
      }
    }
  }

  private roll(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.perPet.clear();
      this.perSigner.clear();
      this.newcomersToday = 0;
      this.allToday = 0;
    }
    this.hour = this.hour.filter((h) => now - h.at < 3_600_000);
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    saveJson(this.file, undefined, JSON.stringify(Object.fromEntries(this.lifetime)));
  }

  /**
   * Takes `n` slots, one for each tape-out the request may send, all at once against every cap, or says why not:
   * `busy` (a daily or hourly cap), `newcomer` (the newcomers' share), `lifetime` (the pet's own).
   */
  take(petId: string, signer: string, settled: boolean, now = Date.now(), n = 1): { ok: true; ticket: SponsorTicket } | { ok: false; reason: "busy" | "newcomer" | "lifetime" } {
    this.roll(now);
    const s = signer.toLowerCase();
    const share = this.caps.newcomerShare ?? 1;
    const life = this.lifetime.get(petId) ?? 0;
    if (this.caps.lifetime && life + n > (settled ? this.caps.lifetime.settled : this.caps.lifetime.newcomer)) return { ok: false, reason: "lifetime" };
    if ((this.perPet.get(petId) ?? 0) + n > this.caps.perPetPerDay || (this.perSigner.get(s) ?? 0) + n > this.caps.perSignerPerDay || this.hour.length + n > this.caps.perHour) return { ok: false, reason: "busy" };
    // the relayer's day holds for settled pets too, and part of each hour stays for pets not yet served today (A142)
    if (this.caps.perDay !== undefined && this.allToday + n > this.caps.perDay) return { ok: false, reason: "busy" };
    if ((this.perPet.get(petId) ?? 0) > 0 && this.hour.length + n > this.caps.perHour - Math.floor(this.caps.perHour * (this.caps.keptForUnserved ?? 0))) return { ok: false, reason: "busy" };
    if (settled && this.caps.settledPerSignerPerHour !== undefined && this.hour.filter((h) => h.settled && h.signer === s).length + n > this.caps.settledPerSignerPerHour) return { ok: false, reason: "busy" };
    if (!settled) {
      const hourNew = this.hour.filter((h) => !h.settled).length;
      if (hourNew + n > Math.floor(this.caps.perHour * share) || (this.caps.perDay !== undefined && this.newcomersToday + n > Math.floor(this.caps.perDay * share))) return { ok: false, reason: "newcomer" };
      this.newcomersToday += n;
    }
    this.perPet.set(petId, (this.perPet.get(petId) ?? 0) + n);
    this.perSigner.set(s, (this.perSigner.get(s) ?? 0) + n);
    for (let i = 0; i < n; i++) this.hour.push({ at: now, settled, signer: s });
    this.allToday += n;
    this.lifetime.set(petId, life + n);
    this.save();
    return { ok: true, ticket: { petId, signer: s, at: now, settled, day: this.day, n } };
  }

  /** Gives back `k` of a ticket's slots (all of them unless said): those tape-outs were not sent. */
  refund(t: SponsorTicket, k = t.n): void {
    const back = Math.max(0, Math.min(k, t.n));
    if (!back) return;
    const life = this.lifetime.get(t.petId) ?? 0;
    if (life > back) this.lifetime.set(t.petId, life - back);
    else this.lifetime.delete(t.petId);
    this.save();
    if (t.day !== this.day) return;
    this.perPet.set(t.petId, Math.max(0, (this.perPet.get(t.petId) ?? 0) - back));
    this.perSigner.set(t.signer, Math.max(0, (this.perSigner.get(t.signer) ?? 0) - back));
    for (let j = 0; j < back; j++) {
      const i = this.hour.findIndex((h) => h.at === t.at && h.settled === t.settled && h.signer === t.signer);
      if (i >= 0) this.hour.splice(i, 1);
    }
    if (!t.settled) this.newcomersToday = Math.max(0, this.newcomersToday - back);
    this.allToday = Math.max(0, this.allToday - back);
  }
}
