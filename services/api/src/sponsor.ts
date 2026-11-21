/**
 * A pet kept on X Layer for a player with no wallet (H4): who may ask, before anything is sent. The relayer hatches
 * the pet to the player's own device key and sends that key a little gas (relayer.ts sponsorHatch); this decides
 * whether it may. It is switched off unless the server is told to turn it on, because it spends the relayer's OKB.
 *
 * A request is the device key's signature over what it asks for (@lingxi/chain sponsor.ts), so nobody can have a pet
 * hatched to an address they do not hold; it is dated, and an address gets one sponsored pet ever, so it cannot be sent
 * twice. One network gets one a day and a /48 three, and the whole game a daily count. A slot is held from the check to
 * the outcome, so two requests at once cannot both pass; a request that sent nothing gives its slot back.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { type Address, type Hex } from "viem";
import { SPONSOR_LINES, lineOfState, sponsorSigner } from "@lingxi/chain";
import { loadJson, saveJson } from "./durable";
import { prefixOf } from "./limit";

/** The gas a sponsored key is sent: about 30 daily saves and a move to a wallet at today's X Layer price. */
export const SPONSOR_GRANT_WEI = 50_000_000_000_000n;
/** What one sponsored pet may cost the relayer at most: the grant, and gas for the hatch and the grant. */
export const SPONSOR_SET_ASIDE_WEI = 80_000_000_000_000n;
/** How old (or how far ahead) a request may be. */
export const SPONSOR_MAX_AGE_MS = 10 * 60_000;

const UINT256_MAX = (1n << 256n) - 1n;
const Body = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  line: z.enum(SPONSOR_LINES),
  state: z.string().regex(/^[0-9]{1,78}$/),
  at: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

export interface SponsoredPet {
  /** the device key, lower case */
  to: string;
  /** null when the hatch was sent and failed */
  petId: string | null;
  /** the network that asked (clientIp.ts) */
  network: string;
  at: number;
  hatchTx: string | null;
  /** null when the gas never arrived; the same key may then ask for the gas alone */
  grantTx: string | null;
}

interface Store {
  pets: SponsoredPet[];
}

export interface SponsorSlot {
  to: string;
  network: string;
  line: (typeof SPONSOR_LINES)[number];
  state: bigint;
  retryGrant: boolean;
  petId: string | null;
}

export type SponsorCheck =
  | ({ ok: true; slot: SponsorSlot; retryGrant: boolean; petId: string | null })
  | { ok: false; reason: "off" | "invalid" | "expired" | "badSignature" | "had" | "busy" | "network" | "budget"; detail: string };

export interface SponsorOptions {
  file: string;
  enabled: boolean;
  /** sponsored pets for the whole game in one UTC day */
  perDay?: number;
  /** for one network (a /64 or an IPv4 address) in a day */
  perNetwork?: number;
  /** for one IPv6 /48 in a day */
  perPrefix?: number;
  now?: () => number;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export class SponsorGate {
  private store: Store;
  private readonly inflight = new Map<string, SponsorSlot>();
  private readonly now: () => number;

  constructor(private readonly o: SponsorOptions) {
    this.now = o.now ?? (() => Date.now());
    const got = loadJson(o.file);
    // with neither the store nor its .bak readable, sponsoring stops rather than forget who already had a pet
    if (got.state === "damaged") throw new Error(`the sponsor store ${o.file} and its .bak could not be read (both kept aside)`);
    this.store = got.state === "ok" ? (got.value as Store) : { pets: [] };
    this.store.pets ??= [];
  }

  get enabled(): boolean {
    return this.o.enabled;
  }

  /** Every sponsored pet, oldest first: for the numbers page (H10). */
  pets(): SponsoredPet[] {
    return this.store.pets.map((p) => ({ ...p }));
  }

  async check(raw: unknown, network: string): Promise<SponsorCheck> {
    if (!this.o.enabled) return { ok: false, reason: "off", detail: "keeping a pet without a wallet is not switched on" };
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid", detail: "bad request" };
    const b = parsed.data;
    const state = BigInt(b.state);
    if (state > UINT256_MAX) return { ok: false, reason: "invalid", detail: "bad request" };
    if (Math.abs(this.now() - b.at) > SPONSOR_MAX_AGE_MS) return { ok: false, reason: "expired", detail: "the request is out of date; ask again" };
    const signer = await sponsorSigner({ to: b.to as Address, line: b.line, state: b.state, at: b.at }, b.signature as Hex);
    if (!signer || signer.toLowerCase() !== b.to.toLowerCase()) return { ok: false, reason: "badSignature", detail: "not signed by the address it names" };
    if (lineOfState(state) !== SPONSOR_LINES.indexOf(b.line)) return { ok: false, reason: "invalid", detail: "the state is not of that line" };

    // from here on nothing awaits: the checks and the slot are one step, so two requests cannot both pass
    const to = b.to.toLowerCase();
    if (this.inflight.has(to)) return { ok: false, reason: "busy", detail: "a request for this pet is already on its way" };
    const had = this.store.pets.find((p) => p.to === to && p.petId !== null);
    if (had && had.grantTx !== null) return { ok: false, reason: "had", detail: "this device already has a pet kept for it" };
    if (had) return this.take({ to, network, line: b.line, state, retryGrant: true, petId: had.petId });

    const today = dayOf(this.now());
    const counted = [...this.store.pets.filter((p) => dayOf(p.at) === today), ...[...this.inflight.values()].filter((s) => !s.retryGrant)];
    const prefix = prefixOf(network);
    if (counted.filter((p) => p.network === network).length >= (this.o.perNetwork ?? 1)) return { ok: false, reason: "network", detail: "this network has had its pet today" };
    if (prefix && counted.filter((p) => prefixOf(p.network) === prefix).length >= (this.o.perPrefix ?? 3)) return { ok: false, reason: "network", detail: "this network has had its pets today" };
    if (counted.length >= (this.o.perDay ?? 25)) return { ok: false, reason: "budget", detail: "today's pets kept for players are all given; try tomorrow" };
    return this.take({ to, network, line: b.line, state, retryGrant: false, petId: null });
  }

  private take(slot: SponsorSlot): SponsorCheck {
    this.inflight.set(slot.to, slot);
    return { ok: true, slot, retryGrant: slot.retryGrant, petId: slot.petId };
  }

  /** The outcome of a slot that sent something: kept for good (a failed hatch too, since its gas was spent). */
  finish(slot: SponsorSlot, outcome: { petId: string | null; hatchTx: string | null; grantTx: string | null }): void {
    this.inflight.delete(slot.to);
    const known = this.store.pets.find((p) => p.to === slot.to && p.petId !== null);
    if (slot.retryGrant && known) known.grantTx = outcome.grantTx;
    else this.store.pets.push({ to: slot.to, petId: outcome.petId, network: slot.network, at: this.now(), hatchTx: outcome.hatchTx, grantTx: outcome.grantTx });
    this.save();
  }

  /** A slot whose request sent nothing: free again. */
  release(slot: SponsorSlot): void {
    this.inflight.delete(slot.to);
  }

  private save(): void {
    mkdirSync(dirname(this.o.file), { recursive: true });
    saveJson(this.o.file, this.store, JSON.stringify(this.store, null, 1));
  }
}
