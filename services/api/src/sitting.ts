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
 *
 * P10: the shelf holds at most MAX_PACKS packs, and the places one network may take shrink as it fills, as a move's do.
 * Each pack's facts (its key's hash, its dates, its owner's codes, its sizes) are a small file of their own beside it,
 * written when it is left or sent home, so no leave rewrites an index of every pack; and what the caps read is kept
 * as counts, so no leave walks the shelf.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import { PREFIX_SHARE, shareOf } from "./limit";
import { CODE, type Coded, codeOf, networkOf, recoded, scrubAsides } from "./pseudonym";
import { hasStore, loadJson } from "./durable";

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
/** packs the shelf holds at once, from everyone (P10): the bytes alone would let tiny packs number in the millions */
export const MAX_PACKS = 20_000;
/** how often packs a week past their end are let go */
const SWEEP_EVERY_MS = 60_000;

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
      // each write waits for the last to settle; the last one's failure was its own caller's
      const next = (writing.get(name) ?? Promise.resolve()).catch(() => undefined).then(run);
      writing.set(name, next);
      // this only tidies the queue; the write's failure is its caller's
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
  return {
    write: async (n, t) => void m.set(n, t),
    read: async (n) => m.get(n) ?? null,
    remove: async (n) => void m.delete(n),
  };
}

/**
 * `dir` holds the packs; a `dir` ending in `.json` is taken as the old single-file store, which is moved into a folder
 * of the same name without the extension.
 */
export function createSittingStore(
  dir?: string,
  now: () => number = Date.now,
  limits: { maxBytes: number; perOwner: number; perNetworkBytes?: number; freeShare?: number; maxPacks?: number } = {
    maxBytes: MAX_SITTING_BYTES,
    perOwner: MAX_PACKS_PER_OWNER,
  },
): SittingStore {
  const legacy = dir?.endsWith(".json") ? dir : undefined;
  const folder = legacy ? legacy.slice(0, -".json".length) : dir;
  const blobs = folder ? folderBlobs(folder) : memoryBlobs();
  const maxPacks = limits.maxPacks ?? MAX_PACKS;
  const index = new Map<string, Entry>();
  let bytes = 0;
  /** what the caps read, kept as packs come and go so a leave never walks the shelf (P10) */
  const owned = new Map<string, number>();
  const places = new Map<string, number>();
  const netBytes = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by: number) => {
    const n = (m.get(k) ?? 0) + by;
    if (n === 0) m.delete(k);
    else m.set(k, n);
  };
  const count = (e: Entry, sign: 1 | -1) => {
    const size = e.size + (e.backSize ?? 0);
    const network = networkOf(ownerOf(e));
    bytes += sign * size;
    bump(owned, e.owner, sign);
    bump(places, network, sign);
    bump(netBytes, network, sign * size);
  };
  /** sets a pack's facts, counting them in place of what it had */
  const put = (code: string, e: Entry) => {
    const had = index.get(code);
    if (had) count(had, -1);
    index.set(code, e);
    count(e, 1);
  };
  const unput = (code: string) => {
    const had = index.get(code);
    if (!had) return;
    index.delete(code);
    count(had, -1);
  };
  /** a pack's facts in a small file of its own beside it (P10); with no folder (tests), the index alone holds them */
  const keepFacts = (code: string, e: Entry) =>
    folder ? blobs.write(`${code}.meta`, JSON.stringify(e)) : Promise.resolve();
  /** an owner kept as an address, before addresses were coded, is coded now (P6a) */
  const coded = (e: Entry): Entry => {
    if (CODE.test(e.owner)) return e;
    const c = recoded(e.owner);
    return { ...e, owner: c.by, ...(c.net !== undefined ? { net: c.net } : {}) };
  };
  // A37: a store moved in from an older layout is ready once every file it needs is written; every call waits for that,
  // so a pack asked for in the first moments after a start is never missed
  const moves: Promise<void>[] = [];
  let ready: Promise<void> = Promise.resolve();

  if (folder) {
    const names = readdirSync(folder);
    for (const name of names) {
      const code = /^([a-f0-9]{24})\.meta$/.exec(name)?.[1];
      if (!code) continue;
      try {
        const e = JSON.parse(readFileSync(join(folder, name), "utf8")) as Entry;
        const c = coded(e);
        put(code, c);
        if (c !== e) moves.push(keepFacts(code, c));
      } catch (err) {
        // facts that cannot be read are kept as they are, never written over, and their pack is not served
        process.stderr.write(`sitting pack ${code} not read: ${(err as Error).message}\n`);
      }
    }
    // the layout before P10: one index of every pack, rewritten on every leave; each pack gets its own facts from it,
    // then the index goes. One that cannot be read is kept aside, never written over (A139)
    const indexFile = join(folder, "index.json");
    if (hasStore(indexFile)) {
      const got = loadJson(indexFile);
      if (got.state === "ok") {
        if (got.from === "bak")
          process.stderr.write(`sitting index could not be read: kept aside, read its .bak instead\n`);
        for (const [code, e] of Object.entries(got.value as Record<string, Entry>)) {
          // facts written since the index are newer, and kept
          if (!SIT_CODE.test(code) || index.has(code)) continue;
          const c = coded(e);
          put(code, c);
          moves.push(keepFacts(code, c));
        }
        const facts = [...moves];
        moves.push(
          Promise.all(facts).then(() => {
            for (const f of [indexFile, `${indexFile}.bak`]) rmSync(f, { force: true });
          }),
        );
      } else if (got.state === "damaged")
        process.stderr.write(`sitting index and its .bak could not be read: both kept aside\n`);
    }
    scrubAsides(folder, "index.json");
    // a pack or homecoming with no facts at all was never handed out (a crash came between its two writes): it goes
    const known = new Set(names.flatMap((n) => /^([a-f0-9]{24})\.meta$/.exec(n)?.[1] ?? []));
    for (const name of names) {
      const code = /^([a-f0-9]{24})\.(pack|back)$/.exec(name)?.[1];
      if (code && !index.has(code) && !known.has(code)) rmSync(join(folder, name), { force: true });
    }
  }
  if (legacy && existsSync(legacy)) {
    // the old layout: one JSON file holding every pack; moved in once, then kept as .migrated
    try {
      const old = JSON.parse(readFileSync(legacy, "utf8")) as Record<
        string,
        { pack: string; keyHash: string; until: number; created: number; back?: string; backAt?: number }
      >;
      const moved: Promise<void>[] = [];
      for (const [code, e] of Object.entries(old)) {
        if (!SIT_CODE.test(code) || index.has(code)) continue;
        const entry: Entry = {
          keyHash: e.keyHash,
          until: e.until,
          created: e.created,
          owner: codeOf("before-migration").by,
          size: e.pack.length,
          ...(e.back ? { backSize: e.back.length, backAt: e.backAt } : {}),
        };
        put(code, entry);
        moved.push(blobs.write(`${code}.pack`, e.pack));
        if (e.back) moved.push(blobs.write(`${code}.back`, e.back));
        moved.push(keepFacts(code, entry));
      }
      moves.push(Promise.all(moved).then(() => renameSync(legacy, `${legacy}.migrated`)));
    } catch (e) {
      process.stderr.write(`sitting store from before could not be read: ${(e as Error).message}\n`);
    }
  }
  if (moves.length)
    ready = Promise.all(moves)
      .then(() => undefined)
      .catch((e: Error) => void process.stderr.write(`sitting migration: ${e.message}\n`));

  const drop = async (code: string) => {
    if (!index.has(code)) return;
    unput(code);
    await Promise.all([blobs.remove(`${code}.pack`), blobs.remove(`${code}.back`), blobs.remove(`${code}.meta`)]);
  };
  // packs a week past their end are let go at most once a minute, so a leave does not walk the shelf each time (P10)
  let swept = Number.NEGATIVE_INFINITY;
  const sweep = async () => {
    const t = now();
    if (t - swept < SWEEP_EVERY_MS) return;
    swept = t;
    const old = [...index].filter(([, e]) => t > e.until + KEEP_AFTER_MS).map(([code]) => code);
    for (const code of old) await drop(code);
  };

  return {
    async leave(pack, keyHash, until, address = "unknown") {
      await ready;
      await sweep();
      if (typeof pack !== "string" || pack.length > MAX_PACK) return { ok: false, reason: "tooBig" };
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return { ok: false, reason: "invalid" };
      if (!Number.isFinite(until) || until < now() || until > now() + MAX_SITTING_MS)
        return { ok: false, reason: "invalid" };
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
      const network = networkOf(owner);
      const theirPlaces = places.get(network) ?? 0;
      if (
        (owned.get(owner.by) ?? 0) >= limits.perOwner ||
        (owner.net !== undefined && theirPlaces >= limits.perOwner * PREFIX_SHARE)
      )
        return { ok: false, reason: "tooMany" };
      if (index.size >= maxPacks) return { ok: false, reason: "full" };
      // the places one network may take shrink as the shelf fills, as a move's do, so a few networks cannot fill it
      if (
        theirPlaces + 1 >
        Math.max(1, shareOf(limits.perOwner * PREFIX_SHARE, maxPacks - index.size, theirPlaces, limits.freeShare))
      )
        return { ok: false, reason: "tooMany" };
      const theirs = netBytes.get(network) ?? 0;
      if (bytes + pack.length > limits.maxBytes) return { ok: false, reason: "full" };
      // and that share shrinks as the shelf fills, so a few networks cannot fill it (A141)
      if (
        theirs + pack.length >
        shareOf(
          limits.perNetworkBytes ?? MAX_SITTING_BYTES_PER_NETWORK,
          limits.maxBytes - bytes,
          theirs,
          limits.freeShare,
        )
      )
        return { ok: false, reason: "tooMany" };
      // the place and the bytes are taken before the write, so requests in flight together cannot all pass the caps
      // above (A76); a write that fails gives them back
      const code = randomBytes(12).toString("hex");
      const entry: Entry = {
        keyHash,
        until,
        created: t,
        owner: owner.by,
        ...(owner.net !== undefined ? { net: owner.net } : {}),
        size: pack.length,
      };
      put(code, entry);
      try {
        await blobs.write(`${code}.pack`, pack);
        await keepFacts(code, entry);
      } catch (e) {
        unput(code);
        await Promise.all([blobs.remove(`${code}.pack`), blobs.remove(`${code}.meta`)]);
        throw e;
      }
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
      if (
        !SIT_CODE.test(code) ||
        typeof key !== "string" ||
        !KEY.test(key) ||
        typeof pet !== "string" ||
        pet.length > MAX_PACK
      )
        return false;
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
      const theirs = netBytes.get(networkOf(ownerOf(e))) ?? 0;
      const grows = pet.length - (e.backSize ?? 0);
      if (
        grows > 0 &&
        theirs + grows >
          shareOf(
            limits.perNetworkBytes ?? MAX_SITTING_BYTES_PER_NETWORK,
            limits.maxBytes - bytes,
            theirs,
            limits.freeShare,
          )
      )
        return false;
      // taken before the write, as for a pack left, and the entry's size with it, so a second sending home at once
      // counts from this one (A76)
      const next: Entry = { ...e, backSize: pet.length, backAt: now() };
      put(code, next);
      try {
        await blobs.write(`${code}.back`, pet);
        await keepFacts(code, next);
      } catch (err) {
        if (index.get(code) === next) put(code, e);
        throw err;
      }
      return true;
    },
    stats: () => ({ packs: index.size, bytes }),
  };
}

/** The hash the owner's game sends for its return key (computed the same way in the browser). */
export const keyHashOf = hash;
