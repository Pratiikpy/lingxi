/**
 * The gate in front of the brain relayer, which spends Lingxi's OKB. A request passes only if it is signed, fresh and
 * new by a key that may keep the pet on chain (see `@lingxi/chain`'s relayAuth.ts), and only within quotas per pet,
 * per signer and for everyone each hour. The relayer itself adds a daily ceiling, an hourly ceiling and a reserve
 * kept for season keepsakes.
 */

import { type Address, type Hex, isAddress, recoverMessageAddress } from "viem";
import { type SignedRelay, relayMessage } from "@lingxi/chain";

const WINDOW_S = 5 * 60;
const NONCE = /^[0-9a-f]{16,64}$/;
const PET = /^\d{1,20}$/;
const MAX_PAYLOAD = 20_000;

export type RelayRefusal = "unsigned" | "expired" | "replayed" | "badSignature" | "notKeeper" | "busy";

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
  req: SignedRelay,
  deps: { isKeeper: (petId: string, who: Address) => Promise<boolean>; now: () => number; nonces: NonceBook },
): Promise<{ ok: true; signer: Address } | { ok: false; reason: RelayRefusal }> {
  const a = req.auth;
  if (!a || !PET.test(req.petId) || typeof req.payload !== "string" || req.payload.length > MAX_PAYLOAD || !isAddress(a.signer) || !NONCE.test(a.nonce) || !Number.isInteger(a.time) || !/^0x[0-9a-fA-F]{130}$/.test(a.signature)) return { ok: false, reason: "unsigned" };
  const now = deps.now();
  if (Math.abs(now / 1000 - a.time) > WINDOW_S) return { ok: false, reason: "expired" };
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: relayMessage({ kind: req.kind, petId: req.petId, payload: req.payload, nonce: a.nonce, time: a.time }), signature: a.signature as Hex });
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

/** Tape-outs per pet and per signer each day, and for everyone each hour. A reused brain costs nothing and is not charged. */
export class RelayQuota {
  private day = "";
  private perPet = new Map<string, number>();
  private perSigner = new Map<string, number>();
  private hour: number[] = [];

  constructor(private readonly caps: { perPetPerDay: number; perSignerPerDay: number; perHour: number }) {}

  private roll(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.perPet.clear();
      this.perSigner.clear();
    }
    this.hour = this.hour.filter((t) => now - t < 3_600_000);
  }

  allow(petId: string, signer: string, now = Date.now()): boolean {
    this.roll(now);
    const s = signer.toLowerCase();
    return (this.perPet.get(petId) ?? 0) < this.caps.perPetPerDay && (this.perSigner.get(s) ?? 0) < this.caps.perSignerPerDay && this.hour.length < this.caps.perHour;
  }

  spend(petId: string, signer: string, now = Date.now()): void {
    this.roll(now);
    const s = signer.toLowerCase();
    this.perPet.set(petId, (this.perPet.get(petId) ?? 0) + 1);
    this.perSigner.set(s, (this.perSigner.get(s) ?? 0) + 1);
    this.hour.push(now);
  }
}
