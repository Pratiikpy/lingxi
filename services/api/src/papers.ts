/**
 * Adoption papers (plan 4.8): the full record of a little one offered at the adoption centre, kept here so the
 * buyer's game can fetch it. Only the pet's owner on X Layer can post them (a wallet signature over the papers'
 * hash), and only while that owner has the pet on offer, so nobody else can replace them. The buyer's game checks
 * the papers against the chain before paying; this server is a mailbox, never the judge.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { type Address, type Hex, keccak256, recoverMessageAddress, toBytes } from "viem";
import { PAPERS_MAX, PapersBody } from "@lingxi/api-schema";
import { clientIp } from "./clientIp";
import { RateLimiter } from "./limit";
import { writeFlushed } from "./durable";

/** The message the owner signs: names the pet and the exact papers. */
export const papersMessage = (petId: string, papers: string) =>
  `Lingxi adoption papers for pet #${petId}\n${keccak256(toBytes(papers))}`;

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

const ID = /^[1-9]\d{0,18}$/;

/** Papers kept, in all; past it the papers posted longest ago go (A83). About 330 of the largest. */
export const MAX_PAPERS_CHARS = 200_000_000;
const MAX_PAPERS = 50_000;
const PET = /^([1-9]\d{0,18})\.json$/;

/**
 * One file per pet in a folder beside `file` (its name without `.json`), so a post writes only its own papers rather
 * than every pet's (A83); a start reads only the files' sizes and times. Papers kept in the older single file are moved
 * into the folder once. Each file is written beside its place under a name of its own and renamed over it (A64, A98),
 * and keeps its post's time as the file's time, so a full shelf lets go the papers posted longest ago, across restarts.
 */
export function createPapersStore(
  file?: string,
  limits: { count: number; chars: number } = { count: MAX_PAPERS, chars: MAX_PAPERS_CHARS },
) {
  const dir = file ? file.replace(/\.json$/, "") : null;
  const memory = new Map<string, Stored>();
  const kept = new Map<string, { at: number; size: number }>();
  let chars = 0;
  let writes = 0;
  const path = (id: string) => join(dir!, `${id}.json`);
  const drop = (id: string) => {
    const k = kept.get(id);
    if (!k) return;
    if (dir) rmSync(path(id), { force: true });
    else memory.delete(id);
    kept.delete(id);
    chars -= k.size;
  };
  const write = (id: string, s: Stored): boolean => {
    const body = JSON.stringify(s);
    if (dir) {
      const tmp = join(dir, `${id}.${process.pid}.${++writes}.tmp`);
      try {
        writeFlushed(tmp, body);
        utimesSync(tmp, s.at / 1000, s.at / 1000);
        renameSync(tmp, path(id));
      } catch (e) {
        rmSync(tmp, { force: true });
        process.stderr.write(`papers not saved: ${(e as Error).message}\n`);
        return false;
      }
    } else memory.set(id, s);
    chars += body.length - (kept.get(id)?.size ?? 0);
    kept.set(id, { at: s.at, size: body.length });
    return true;
  };
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".tmp")) rmSync(join(dir, name), { force: true });
      const m = PET.exec(name);
      if (!m) continue;
      const st = statSync(join(dir, name));
      kept.set(m[1]!, { at: st.mtimeMs, size: st.size });
      chars += st.size;
    }
    // the older single file, moved into the folder once
    if (file && existsSync(file)) {
      try {
        const old = JSON.parse(readFileSync(file, "utf8")) as Record<string, Stored>;
        for (const [id, s] of Object.entries(old)) if (ID.test(id) && !kept.has(id)) write(id, s);
        renameSync(file, `${file}.migrated`);
      } catch (e) {
        process.stderr.write(`older papers file not moved: ${(e as Error).message}\n`);
      }
    }
  }
  return {
    /** read off the request thread: a pet's papers run to 600 KB (A119) */
    get: async (petId: string): Promise<Stored | null> => {
      if (!kept.has(petId)) return null;
      if (!dir) return memory.get(petId) ?? null;
      try {
        return JSON.parse(await readFile(path(petId), "utf8")) as Stored;
      } catch {
        return null;
      }
    },
    put: (petId: string, s: Stored) => {
      if (!write(petId, s)) return;
      if (kept.size <= limits.count && chars <= limits.chars) return;
      // a full shelf lets go the papers posted longest ago, never these
      for (const [old] of [...kept].sort((a, b) => a[1].at - b[1].at)) {
        if (kept.size <= limits.count && chars <= limits.chars) break;
        if (old !== petId) drop(old);
      }
    },
    size: () => kept.size,
  };
}
export type PapersStore = ReturnType<typeof createPapersStore>;

export function withPapers(
  app: Hono,
  store: PapersStore,
  chain: PapersChain,
  now: () => number = Date.now,
  limiter = new RateLimiter(30, 3_600_000),
): Hono {
  app.get("/api/papers/:petId", async (c) => {
    c.header("access-control-allow-origin", "*");
    // papers are public and change only when their owner signs again: a short shared cache spares repeat reads (A119)
    c.header("cache-control", "public, max-age=15");
    const id = c.req.param("petId");
    if (!ID.test(id)) return c.json({ ok: false, reason: "petId" }, 400);
    const s = await store.get(id);
    // no papers yet is an ordinary answer, not an error a buyer's browser should log
    return s
      ? c.json({ ok: true, papers: s.papers, signer: s.signer, at: s.at })
      : c.json({ ok: false, reason: "none" });
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
      signer = await recoverMessageAddress({
        message: papersMessage(id, body.papers),
        signature: body.signature as Hex,
      });
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
    if (!seller || seller.toLowerCase() !== signer.toLowerCase())
      return c.json({ ok: false, reason: "notOffered" }, 409);
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
