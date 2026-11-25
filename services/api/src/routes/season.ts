/**
 * Seasons and sponsored keeping (P7: out of server.ts): entries, standings and proofs, and the free keep.
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { type Context, Hono } from "hono";
import { SeasonEnterBody } from "@lingxi/api-schema";
import { RateLimiter } from "../limit";
import { BrainRelayer } from "../relayer";
import { SponsorGate } from "../sponsor";
import { type SeasonStore } from "../season";
import { weekOf } from "@lingxi/game";
import { type Address } from "viem";
import { type Deployment, type SignedRelay } from "@lingxi/chain";
import { clientIp } from "../clientIp";
import { busy } from "./play";

/** Weekly seasons: enter this week with one tap; read any week's entries and standings. */
/** Proves an entry is a pet on X Layer (seasonProof.ts); without it, entries are open but cannot win the keepsake. */
export type SeasonProver = (
  pet: unknown,
  proof: SignedRelay,
) => Promise<{ ok: true; petId: string } | { ok: false; reason: string }>;

export function withSeason(
  app: Hono,
  store: SeasonStore,
  writes = new RateLimiter(30, 3_600_000),
  now: () => number = Date.now,
  prove?: SeasonProver,
): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/season/enter", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = SeasonEnterBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    // an entry that says it is a pet on X Layer must prove it; one that fails is refused, never entered unproven
    let petId: string | undefined;
    if (body.proof !== undefined) {
      if (!prove)
        return c.json({ ok: false, reason: "noProof", detail: "this server cannot check pets on chain" }, 503);
      const p = await prove(body.pet, body.proof as SignedRelay);
      // an expected answer in play (its mind on chain is behind, say), so 200 with the reason, like "full" and "busy"
      if (!p.ok) return c.json({ ok: false, reason: "notProven", detail: p.reason });
      petId = p.petId;
    }
    const r = store.enter(body.pet, body.device, { from: who(c), ...(petId ? { petId } : {}) });
    // a full week, or this address's share of it, is normal play: answer 200 so the page shows our own message.
    // `proven` is what the page may tell the player: never assumed from having sent a proof
    return c.json(
      r.ok ? { ...r, proven: !!petId } : r,
      r.ok || r.reason === "full" || r.reason === "tooMany" ? 200 : 400,
    );
  });
  // each week's answer is written once per change of it and served from that text (A78): a week's season carries
  // every entry's card, and writing it out again for every read took the request thread
  const written = new Map<
    string,
    { of: unknown; standings: unknown; closed: boolean; award: unknown; pending: unknown; text: string }
  >();
  app.get("/api/season/:week", (c) => {
    const week = c.req.param("week") === "current" ? weekOf(now()) : c.req.param("week");
    const v = store.view(week);
    if (!v) return c.json({ ok: false, reason: "invalid" }, 400);
    // an open week changes with every entry, so it is never served from a cache
    c.header("Cache-Control", v.closed ? "public, max-age=3600" : "no-store");
    const held = written.get(week);
    const same =
      held &&
      held.of === v.entries &&
      held.standings === v.standings &&
      held.closed === v.closed &&
      held.award === v.award &&
      held.pending === v.pending;
    const text = same ? held.text : JSON.stringify({ ok: true, ...v });
    if (!same) {
      written.set(week, {
        of: v.entries,
        standings: v.standings,
        closed: v.closed,
        award: v.award,
        pending: v.pending,
        text,
      });
      if (written.size > 8) written.delete(written.keys().next().value!);
    }
    c.header("content-type", "application/json; charset=utf-8");
    return c.body(text);
  });
  return app;
}

/** What the sponsor route needs: who may ask (sponsor.ts), the relayer that sends, and the deployment it sends to. */
export interface Sponsoring {
  gate: SponsorGate;
  relayer: Pick<BrainRelayer, "sponsorHatch" | "sponsorGrant">;
  deployment: Deployment;
  who: (c: Context) => string;
}

/**
 * Each refusal's status. One that is normal play (switched off, already had, the network's pet today, the day's budget
 * spent, a request already on its way, the OKB held for keepsakes) answers 200 with its reason, like the tape-out's
 * "newcomer", so the page shows its own message and the browser logs no error (B9); a malformed, forged or stale
 * request, or a failed send, keeps its error status.
 */
export const SPONSOR_STATUS: Record<string, 200 | 400 | 401 | 502> = {
  off: 200,
  invalid: 400,
  expired: 401,
  badSignature: 401,
  had: 200,
  busy: 200,
  network: 200,
  budget: 200,
  relayLow: 200,
  error: 502,
};

/**
 * A pet kept on X Layer for a player with no wallet (H4): the relayer hatches it to their device key and sends that
 * key its gas. Off unless the server is switched on for it; every refusal is named and sends nothing.
 */
export function withSponsor(app: Hono, s: Sponsoring | null, limiter = new RateLimiter(20, 3_600_000)): Hono {
  app.get("/api/sponsor", (c) => c.json({ ok: true, on: !!s?.gate.enabled }, 200, { "cache-control": "no-store" }));
  // what was kept for a device key, so a game whose answer was lost on the way can find its pet (X Layer confirms it)
  app.get("/api/sponsor/of/:address", (c) => {
    const to = c.req.param("address").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(to)) return c.json({ ok: false, reason: "invalid", detail: "bad address" }, 400);
    const p = s?.gate.pets().find((x) => x.to === to && x.petId !== null);
    return p
      ? c.json({ ok: true, petId: p.petId, hatchTx: p.hatchTx, grantTx: p.grantTx })
      : c.json({ ok: false, reason: "none", detail: "nothing kept for this address" }, 404);
  });
  app.post("/api/sponsor/hatch", async (c) => {
    if (!s || !s.gate.enabled)
      return c.json({ ok: false, reason: "off", detail: "keeping a pet without a wallet is not switched on" }, 200);
    const ip = s.who(c);
    if (!limiter.take(ip))
      return c.json({ ok: false, reason: "busy", detail: "too many requests; try again later" }, 429);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid", detail: "bad request" }, 400);
    }
    const r = await s.gate.check(body, ip);
    if (!r.ok) return c.json({ ok: false, reason: r.reason, detail: r.detail }, SPONSOR_STATUS[r.reason] ?? 400);
    const slot = r.slot;
    try {
      if (r.retryGrant) {
        const g = await s.relayer.sponsorGrant(slot.to as Address);
        if (!g.ok) {
          s.gate.release(slot);
          return c.json({ ok: false, reason: g.reason, detail: g.detail }, SPONSOR_STATUS[g.reason] ?? 502);
        }
        s.gate.finish(slot, { petId: slot.petId, hatchTx: null, grantTx: g.grantTx, spentWei: g.spentWei });
        return c.json({ ok: true, petId: slot.petId, hatchTx: null, grantTx: g.grantTx });
      }
      const h = await s.relayer.sponsorHatch(s.deployment, slot.to as Address, slot.line, slot.state);
      if (!h.ok) {
        // a hatch that cost gas is kept, so the day's count holds it; one that sent nothing gives its slot back
        if (h.spent)
          s.gate.finish(slot, {
            petId: null,
            hatchTx: null,
            grantTx: null,
            ...(h.spentWei !== undefined ? { spentWei: h.spentWei } : {}),
          });
        else s.gate.release(slot);
        return c.json({ ok: false, reason: h.reason, detail: h.detail }, SPONSOR_STATUS[h.reason] ?? 502);
      }
      s.gate.finish(slot, { petId: h.petId, hatchTx: h.hatchTx, grantTx: h.grantTx, spentWei: h.spentWei });
      return c.json({ ok: true, petId: h.petId, hatchTx: h.hatchTx, grantTx: h.grantTx });
    } catch (e) {
      s.gate.release(slot);
      throw e;
    }
  });
  return app;
}
