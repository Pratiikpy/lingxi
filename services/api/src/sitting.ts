/**
 * Pet-sitting packs (PRD C10, M2): the owner leaves the pet here for a friend to
 * collect, and the friend leaves it here to come home. A pack is reached only by
 * its random code; sending the pet home also needs the return key from the
 * owner's link, of which only a hash is kept. The server never judges the pet:
 * the owner's game checks every returned thought against its own log before it
 * accepts anything (see @lingxi/game sitting.ts).
 *
 * Kept so that no visitor can exhaust it: only a small index lives in memory, each pack is its own file written
 * atomically off the event loop, all packs together stay within a byte budget, and one address may have only a
 * few waiting at once. A store from before this layout (one JSON file) is moved into it on first start.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import { shareOf } from "./limit";
import { CODE, type Coded, codeOf, heldOverCoded, networkOf, recoded, scrubAsides } from "./pseudonym";
import { hasStore, loadJson, saveJson } from "./durable";

const MAX_PACK = SEND_LIMITS.sitPackChars;
const KEEP_AFTER_MS = 7 * 86_400_000;
const MAX_SITTING_MS = 31 * 86_400_000;
const SIT_CODE = /^[a-f0-9]{24}$/;
const KEY = /^[a-f0-9]{32}$/;
/** all packs and their homecomings together */
export const MAX_SITTING_BYTES = 256 * 1024 * 1024;
/** packs one address may have waiting at once; an IPv6 /48 may have four addresses' worth (A118) */
export const MAX_PACKS_PER_OWNER = 8;
/** the shelf's bytes one address, or one IPv6 /48 however many /64s it uses, may hold (A118) */
export const MAX_SITTING_BYTES_PER_NETWORK = MAX_SITTING_BYTES / 16;

interface Entry {
  keyHash: string;
  until: number;
  created: number;
  /** the code of the address that left it (never the address, P6a) */
  owner: string;
  /** the code of that address's IPv6 /48, when it has one */
  net?: string;
  size: number;
  backSize?: number;
  backAt?: number;
}

/** Who left a pack, as the index keeps it. */
const ownerOf = (e: Entry): Coded => (e.net !== undefined ? { by: e.owner, net: e.net } : { by: e.owner });
/** The bytes the network of `who` holds on the shelf, packs and homecomings. */
const heldBy = (index: Map<string, Entry>, who: Coded) => {
  const network = networkOf(who);
  return [...index.values()].filter((e) => networkOf(ownerOf(e)) === network).reduce((n, e) => n + e.size + (e.backSize ?? 0), 0);
};

const hash = (k: string) => createHash("sha256").update(`lingxi-sit:${k}`).digest("hex");

export type LeaveResult = { ok: true; code: string } | { ok: false; reason: "tooBig" | "invalid" | "full" | "tooMany" };

export interface SittingStore {
  leave: (pack: string, keyHash: string, until: number, owner?: string) => Promise<LeaveResult>;
  collect: (code: string) => Promise<{ pack: string; back?: string; backAt?: number } | null>;
  sendHome: (code: string, key: string, pet: string) => Promise<boolean>;
  stats: () => { packs: number; bytes: number };
}

/** Where pack texts live: files in a folder, or memory when no folder is given (tests). */
interface Blobs {
  write(name: string, text: string): Promise<void>;
  read(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
}

function folderBlobs(dir: string): Blobs {
  mkdirSync(dir, { recursive: true });
  // a write a crash cut short leaves only its temporary file, which nothing reads: cleared on open (A98)
  for (const f of readdirSync(dir)) if (f.endsWith(".tmp")) rmSync(join(dir, f), { force: true });
  // writes of one name go one after another: two renames onto one file at once fail on Windows (EPERM) (A98)
  const writing = new Map<string, Promise<void>>();
  return {
    write(name, text) {
      const p = join(dir, name);
      const run = async () => {
        // each write its own temporary file, removed if the write fails
        const tmp = `${p}.${randomBytes(6).toString("hex")}.tmp`;
        try {
          // flushed to disk before it takes its place, so a crash leaves the old file or the new, never half (A139)
          const fh = await open(tmp, "w");
          try {
            await fh.writeFile(text);
            await fh.sync();
          } finally {
            await fh.close();
          }
          await rename(tmp, p);
        } catch (e) {
          await rm(tmp, { force: true });
          throw e;
        }
      };
      const next = (writing.get(name) ?? Promise.resolve()).catch(() => undefined).then(run);
      writing.set(name, next);
      void next.finally(() => writing.get(name) === next && writing.delete(name)).catch(() => undefined);
      return next;
    },
    async read(name) {
      try {
        return await readFile(join(dir, name), "utf8");
      } catch {
        return null;
      }
    },
    async remove(name) {
      await rm(join(dir, name), { force: true });
    },
  };
}

function memoryBlobs(): Blobs {
  const m = new Map<string, string>();
  return { write: async (n, t) => void m.set(n, t), read: async (n) => m.get(n) ?? null, remove: async (n) => void m.delete(n) };
}

/**
 * `dir` holds the packs; a `dir` ending in `.json` is taken as the old single-file store, which is moved into a folder
 * of the same name without the extension.
 */
export function createSittingStore(dir?: string, now: () => number = Date.now, limits: { maxBytes: number; perOwner: number; perNetworkBytes?: number; freeShare?: number } = { maxBytes: MAX_SITTING_BYTES, perOwner: MAX_PACKS_PER_OWNER }): SittingStore {
  const legacy = dir?.endsWith(".json") ? dir : undefined;
  const folder = legacy ? legacy.slice(0, -".json".length) : dir;
  const blobs = folder ? folderBlobs(folder) : memoryBlobs();
  const index = new Map<string, Entry>();
  let bytes = 0;
  /** an index kept before addresses were coded held its owners' addresses: they are coded on load (P6a) */
  let raw = false;

  // the index, or its .bak when a crash cut it short; one that cannot be read is kept aside, never written over (A139)
  if (folder && hasStore(join(folder, "index.json"))) {
    const got = loadJson(join(folder, "index.json"));
    if (got.state === "ok") {
      if (got.from === "bak") process.stderr.write(`sitting index could not be read: kept aside, read its .bak instead\n`);
      for (const [code, e] of Object.entries(got.value as Record<string, Entry>)) {
        if (!SIT_CODE.test(code)) continue;
        if (CODE.test(e.owner)) index.set(code, e);
        else {
          const c = recoded(e.owner);
          index.set(code, { ...e, owner: c.by, ...(c.net !== undefined ? { net: c.net } : {}) });
          raw = true;
        }
        bytes += e.size + (e.backSize ?? 0);
      }
    } else if (got.state === "damaged") process.stderr.write(`sitting index and its .bak could not be read: both kept aside\n`);
  }

  // writes of the index go one after another, so a slow disk never interleaves two renames
  let queue: Promise<void> = Promise.resolve();
  const saveIndex = () => {
    if (!folder) return Promise.resolve();
    const text = JSON.stringify(Object.fromEntries(index));
    queue = queue
      .then(() => (folder ? saveJson(join(folder, "index.json"), undefined, text) : blobs.write("index.json", text)))
      .catch((e: Error) => {
        process.stderr.write(`sitting index not saved: ${e.message}\n`);
      });
    return queue;
  };

  // A37: a store moved in from the old layout lists its packs at once, while their files are still being written; it is
  // ready once every file is written, the index saved and the old file set aside, and every call waits for that, so a
  // pack asked for in the first moments after a start is never missed
  let ready: Promise<void> = Promise.resolve();
  if (folder) {
    // written twice, so the .bak each write keeps holds no address either
    if (raw) ready = saveIndex().then(saveIndex);
    scrubAsides(folder, "index.json");
  }
  if (legacy && existsSync(legacy)) {
    // the old layout: one JSON file holding every pack; moved in once, then kept as .migrated
    try {
      const old = JSON.parse(readFileSync(legacy, "utf8")) as Record<string, { pack: string; keyHash: string; until: number; created: number; back?: string; backAt?: number }>;
      const moves: Promise<void>[] = [];
      for (const [code, e] of Object.entries(old)) {
        if (!SIT_CODE.test(code) || index.has(code)) continue;
        index.set(code, { keyHash: e.keyHash, until: e.until, created: e.created, owner: codeOf("before-migration").by, size: e.pack.length, ...(e.back ? { backSize: e.back.length, backAt: e.backAt } : {}) });
        bytes += e.pack.length + (e.back?.length ?? 0);
        moves.push(blobs.write(`${code}.pack`, e.pack));
        if (e.back) moves.push(blobs.write(`${code}.back`, e.back));
      }
      const coded = ready;
      ready = Promise.all([coded, ...moves])
        .then(saveIndex)
        .then(() => renameSync(legacy, `${legacy}.migrated`))
        .catch((e: Error) => void process.stderr.write(`sitting migration: ${e.message}\n`));
    } catch (e) {
      process.stderr.write(`sitting store from before could not be read: ${(e as Error).message}\n`);
    }
  }

  const drop = async (code: string) => {
    const e = index.get(code);
    if (!e) return;
    index.delete(code);
    bytes -= e.size + (e.backSize ?? 0);
    await Promise.all([blobs.remove(`${code}.pack`), blobs.remove(`${code}.back`)]);
  };
  const sweep = async () => {
    const t = now();
    const old = [...index].filter(([, e]) => t > e.until + KEEP_AFTER_MS).map(([code]) => code);
    if (!old.length) return;
    for (const code of old) await drop(code);
    await saveIndex();
  };

  return {
    async leave(pack, keyHash, until, address = "unknown") {
      await ready;
      await sweep();
      if (typeof pack !== "string" || pack.length > MAX_PACK) return { ok: false, reason: "tooBig" };
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return { ok: false, reason: "invalid" };
      if (!Number.isFinite(until) || until < now() || until > now() + MAX_SITTING_MS) return { ok: false, reason: "invalid" };
      try {
        const p = JSON.parse(pack) as { v?: unknown; pet?: { bornAt?: unknown } };
        if (p.v !== 1 || typeof p.pet?.bornAt !== "number") return { ok: false, reason: "invalid" };
      } catch {
        return { ok: false, reason: "invalid" };
      }
      const t = now();
      // every pack this address still has on the shelf counts, past its end date too: each is kept a week after it
      // ends, and a short end date must not slip past the cap (A50)
      // an IPv6 /48 holds four addresses' worth of packs, and no sender more than its share of the bytes (A118)
      const owner = codeOf(address);
      if (heldOverCoded([...index.values()].map(ownerOf), owner, limits.perOwner)) return { ok: false, reason: "tooMany" };
      const theirs = heldBy(index, owner);
      if (bytes + pack.length > limits.maxBytes) return { ok: false, reason: "full" };
      // and that share shrinks as the shelf fills, so a few networks cannot fill it (A141)
      if (theirs + pack.length > shareOf(limits.perNetworkBytes ?? MAX_SITTING_BYTES_PER_NETWORK, limits.maxBytes - bytes, theirs, limits.freeShare)) return { ok: false, reason: "tooMany" };
      // the place and the bytes are taken before the write, so requests in flight together cannot all pass the caps
      // above (A76); a write that fails gives them back
      const code = randomBytes(12).toString("hex");
      index.set(code, { keyHash, until, created: t, owner: owner.by, ...(owner.net !== undefined ? { net: owner.net } : {}), size: pack.length });
      bytes += pack.length;
      try {
        await blobs.write(`${code}.pack`, pack);
      } catch (e) {
        index.delete(code);
        bytes -= pack.length;
        throw e;
      }
      await saveIndex();
      return { ok: true, code };
    },
    async collect(code) {
      if (!SIT_CODE.test(code)) return null;
      await ready;
      const e = index.get(code);
      if (!e) return null;
      const pack = await blobs.read(`${code}.pack`);
      if (pack === null) return null;
      const back = e.backSize !== undefined ? await blobs.read(`${code}.back`) : null;
      return { pack, ...(back !== null ? { back, backAt: e.backAt } : {}) };
    },
    async sendHome(code, key, pet) {
      if (!SIT_CODE.test(code) || typeof key !== "string" || !KEY.test(key) || typeof pet !== "string" || pet.length > MAX_PACK) return false;
      await ready;
      const e = index.get(code);
      if (!e || e.keyHash !== hash(key)) return false;
      try {
        JSON.parse(pet);
      } catch {
        return false;
      }
      if (bytes - (e.backSize ?? 0) + pet.length > limits.maxBytes) return false;
      // a homecoming counts against the pack owner's network share, as its pack did (A146)
      const theirs = heldBy(index, ownerOf(e));
      const grows = pet.length - (e.backSize ?? 0);
      if (grows > 0 && theirs + grows > shareOf(limits.perNetworkBytes ?? MAX_SITTING_BYTES_PER_NETWORK, limits.maxBytes - bytes, theirs, limits.freeShare)) return false;
      // taken before the write, as for a pack left, and the entry's size with it, so a second sending home at once
      // counts from this one (A76)
      const grow = pet.length - (e.backSize ?? 0);
      bytes += grow;
      index.set(code, { ...e, backSize: pet.length, backAt: now() });
      try {
        await blobs.write(`${code}.back`, pet);
      } catch (err) {
        bytes -= grow;
        if (index.get(code)?.backSize === pet.length) index.set(code, e);
        throw err;
      }
      await saveIndex();
      return true;
    },
    stats: () => ({ packs: index.size, bytes }),
  };
}

/** The hash the owner's game sends for its return key (computed the same way in the browser). */
export const keyHashOf = hash;
