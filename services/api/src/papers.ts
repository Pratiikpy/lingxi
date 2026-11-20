/**
 * Adoption papers (plan 4.8): the full record of a little one offered at the adoption centre, kept here so the
 * buyer's game can fetch it. Only the pet's owner on X Layer can post them (a wallet signature over the papers'
 * hash), and only while that owner has the pet on offer, so nobody else can replace them. The buyer's game checks
 * the papers against the chain before paying; this server is a mailbox, never the judge.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hono } from "hono";
import { type Address, type Hex, keccak256, recoverMessageAddress, toBytes } from "viem";
import { PAPERS_MAX, PapersBody } from "@lingxi/api-schema";
import { clientIp } from "./clientIp";
import { RateLimiter } from "./limit";

/** The message the owner signs: names the pet and the exact papers. */
export const papersMessage = (petId: string, papers: string) => `Lingxi adoption papers for pet #${petId}\n${keccak256(toBytes(papers))}`;

export interface PapersChain {
  ownerOf: (petId: bigint) => Promise<Address>;
  /** the seller of the pet's current offer, or null when it is not on offer */
  sellerOf: (petId: bigint) => Promise<Address | null>;
}

interface Stored {
  papers: string;
  signer: string;
  at: number;
}

export function createPapersStore(file?: string) {
  let data: Record<string, Stored> = {};
  if (file && existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8")) as Record<string, Stored>;
    } catch {
      data = {};
    }
  }
  const save = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  };
  return {
    get: (petId: string): Stored | null => data[petId] ?? null,
    put: (petId: string, s: Stored) => {
      data[petId] = s;
      save();
    },
  };
}
export type PapersStore = ReturnType<typeof createPapersStore>;

const ID = /^[1-9]\d{0,18}$/;

export function withPapers(app: Hono, store: PapersStore, chain: PapersChain, now: () => number = Date.now, limiter = new RateLimiter(30, 3_600_000)): Hono {
  app.get("/api/papers/:petId", (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "no-store");
    const id = c.req.param("petId");
    if (!ID.test(id)) return c.json({ ok: false, reason: "petId" }, 400);
    const s = store.get(id);
    // no papers yet is an ordinary answer, not an error a buyer's browser should log
    return s ? c.json({ ok: true, papers: s.papers, signer: s.signer, at: s.at }) : c.json({ ok: false, reason: "none" });
  });

  app.post("/api/papers/:petId", async (c) => {
    c.header("access-control-allow-origin", "*");
    // each post costs two reads of X Layer: an address is held to 30 an hour before any is made (A52)
    if (!limiter.take(clientIp(c))) return c.json({ ok: false, reason: "busy" });
    const id = c.req.param("petId");
    if (!ID.test(id)) return c.json({ ok: false, reason: "petId" }, 400);
    const raw = await c.req.text();
    if (raw.length > PAPERS_MAX + 1_000) return c.json({ ok: false, reason: "tooBig" }, 413);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, reason: "json" }, 400);
    }
    const parsed = PapersBody.safeParse(json);
    if (!parsed.success) return c.json({ ok: false, reason: "invalid" }, 400);
    const body = parsed.data;
    let signer: Address;
    try {
      signer = await recoverMessageAddress({ message: papersMessage(id, body.papers), signature: body.signature as Hex });
    } catch {
      return c.json({ ok: false, reason: "signature" }, 400);
    }
    let owner: Address;
    let seller: Address | null;
    try {
      [owner, seller] = await Promise.all([chain.ownerOf(BigInt(id)), chain.sellerOf(BigInt(id))]);
    } catch {
      return c.json({ ok: false, reason: "chain" }, 503);
    }
    if (owner.toLowerCase() !== signer.toLowerCase()) return c.json({ ok: false, reason: "notOwner" }, 403);
    if (!seller || seller.toLowerCase() !== signer.toLowerCase()) return c.json({ ok: false, reason: "notOffered" }, 409);
    store.put(id, { papers: body.papers, signer: signer.toLowerCase(), at: now() });
    return c.json({ ok: true });
  });

  app.options("/api/papers/:petId", (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-methods", "GET, POST, OPTIONS");
    c.header("access-control-allow-headers", "content-type");
    return c.body(null, 204);
  });
  return app;
}
