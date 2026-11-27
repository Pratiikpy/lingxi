/**
 * Public diaries (PRD Z1): an owner publishes the log their pet's last checkpoint
 * committed to, so the pet's public page can show its diary to anyone. A log is
 * kept only if its hash chain equals the log hash saved on chain for that pet, so
 * nothing here can put words in a pet's mouth; the page checks it again itself.
 *
 * A39: no log is held in memory. Each is a file, and a read streams it. Three
 * bounds are checked before anything is written: a log holds no more words than
 * its pet could have lived (ten a minute since it hatched on chain, never fewer
 * than a floor, never more than the send limit); an address publishes so much a
 * day; and the shelf holds so much in all, refusing a new diary when full rather
 * than evicting one it keeps (an eviction would let a flood push honest ones out).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { PublishedLog } from "@lingxi/api-schema";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { PREFIX_SHARE, prefixOf } from "./limit";
import { writeFlushed } from "./durable";

/** Words a pet's log may hold for each minute it has lived: one a beat, the rest care (a player would have to tap nine times a minute, all its life). */
export const DIARY_WORDS_PER_MINUTE = 10;
/** The fewest words any pet's log may hold, whatever its age: a first hour of play. */
export const DIARY_FLOOR_WORDS = 5_000;
/** What the shelf holds in all, and what one address may publish in a day (bytes of stored JSON). */
const TOTAL_BYTES = 256 * 1024 * 1024;
const PER_ADDRESS_BYTES_PER_DAY = 16 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** what a log that does not match costs its sender at the least, however small it is (A145) */
const MIN_MISMATCH_CHARGE = 64 * 1024;
const ID = /^\d{1,12}$/;

export type PublishResult =
  | { ok: true; beats: number }
  | { ok: false; reason: "invalid" | "mismatch" | "unknown" | "older" | "tooLong" | "busy" | "full" };

/**
 * What the chain says of a pet: the log hash it saved, when it hatched, and the chain's time now (seconds). The pet's
 * age is taken on the chain's own clock at both ends, never against this server's (a chain can run behind it).
 */
export interface PetOnChain {
  logHash: string;
  born: number;
  /** the latest block's time; this server's clock when not given (tests) */
  at?: number;
}

/** The most words a pet hatched at `born` (seconds) may have logged by `now` (ms). */
export const diaryMaxWords = (born: number, now: number) =>
  Math.min(
    SEND_LIMITS.logWords,
    Math.max(DIARY_FLOOR_WORDS, Math.ceil(Math.max(0, now / 1000 - born) / 60) * DIARY_WORDS_PER_MINUTE),
  );

/** A read marks a diary at most this often, on its file too (A80). */
const TOUCH_MS = 60_000;

export function createDiaryStore(
  dir?: string,
  opts: { now?: () => number; totalBytes?: number; perAddressBytesPerDay?: number } = {},
) {
  const now = opts.now ?? Date.now;
  const totalBytes = opts.totalBytes ?? TOTAL_BYTES;
  const perAddress = opts.perAddressBytesPerDay ?? PER_ADDRESS_BYTES_PER_DAY;
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = (id: string) => join(dir!, `${id}.json`);
  /**
   * what is kept, by pet: its size, its word count once read (a start reads no diary, A80), and when it was last
   * published or read, which decides what a full shelf lets go
   */
  const index = new Map<string, { bytes: number; words?: number; at: number }>();
  /** without a folder (tests), the logs' text */
  const texts = new Map<string, string>();
  let total = 0;
  if (dir) {
    // only each file's size and time: no diary is read to open the shelf, however many it holds (A80); a file a write
    // left half-done is a `.tmp`, never listed
    for (const name of readdirSync(dir)) {
      // a write a crash cut short left a temporary file: it is cleared, never listed (A123)
      if (name.endsWith(".tmp")) {
        rmSync(join(dir, name), { force: true });
        continue;
      }
      const id = name.replace(/\.json$/, "");
      if (!ID.test(id) || !name.endsWith(".json")) continue;
      try {
        const st = statSync(join(dir, name));
        index.set(id, { bytes: st.size, at: st.mtimeMs });
        total += st.size;
      } catch {
        // gone while listed: not counted
      }
    }
  }
  /** what each sender (and each IPv6 /48) spent on `spentDay`, the latest day anything was spent */
  const spent = new Map<string, { day: number; bytes: number }>();
  let spentDay = -Infinity;

  const text = (id: string): string | null => {
    if (!index.has(id)) return null;
    if (!dir) return texts.get(id) ?? null;
    try {
      return readFileSync(file(id), "utf8");
    } catch {
      return null;
    }
  };

  /** A kept log, parsed now and not kept in memory. */
  const read = (id: string): PublishedLog | null => {
    const t = text(id);
    if (t === null) return null;
    try {
      return PublishedLog.parse(JSON.parse(t));
    } catch {
      return null;
    }
  };

  type Held = { bytes: number; words?: number; at: number };
  type Plan = { ok: true; body: string; held: Held | undefined; t: number; day: number; grows: number };
  type Refusal = { ok: false; reason: "invalid" | "unknown" | "tooLong" | "older" | "busy" | "full" };

  /** what `from` has spent today, in bytes */
  const spentToday = (from: string, day: number) => {
    const mine = spent.get(from);
    return mine?.day === day ? mine.bytes : 0;
  };
  /**
   * spends `bytes` of `from`'s day, and of its IPv6 /48's (A123). An earlier day's spending is never read again
   * (spentToday counts only the day asked for), so a new day lets it go, as duels.ts does: kept, it held one entry for
   * every address that ever published, for good (P10)
   */
  const addSpent = (from: string, day: number, bytes: number) => {
    if (day > spentDay) {
      spentDay = day;
      spent.clear();
    }
    for (const k of [from, ...(prefixOf(from) !== null ? [prefixOf(from)!] : [])])
      spent.set(k, { day, bytes: spentToday(k, day) + bytes });
  };
  const charge = (from: string, bytes: number) => addSpent(from, Math.floor(now() / DAY_MS), bytes);

  /** Every bound that needs no hash: the log's shape, its pet's age, a longer kept diary, the sender's bytes, the shelf. */
  const check = (log: PublishedLog, chain: PetOnChain | null, from: string): Plan | Refusal => {
    const joined = log.segments.flatMap((x) => x.words);
    if (joined.length !== log.words.length || joined.some((w, i) => w !== log.words[i]))
      return { ok: false, reason: "invalid" };
    if (!chain) return { ok: false, reason: "unknown" };
    const t = now();
    if (log.words.length > diaryMaxWords(chain.born, chain.at !== undefined ? chain.at * 1000 : t))
      return { ok: false, reason: "tooLong" };
    const held = index.get(log.petId);
    // the kept diary's length, read from its file the first time it is needed (A80)
    const heldWords = held ? (held.words ?? read(log.petId)?.words.length ?? 0) : 0;
    if (held && heldWords > log.words.length) return { ok: false, reason: "older" };
    const body = JSON.stringify(log);
    const grows = Math.max(0, body.length - (held?.bytes ?? 0));
    const day = Math.floor(t / DAY_MS);
    const today = spentToday(from, day);
    const prefix = prefixOf(from);
    // an address publishes its day's bytes, and its IPv6 /48 four addresses' worth (A123)
    if (today + grows > perAddress || (prefix !== null && spentToday(prefix, day) + grows > perAddress * PREFIX_SHARE))
      return { ok: false, reason: "busy" };
    // a full shelf can let go of every other diary; one too big even for that is refused before it is hashed
    if (body.length > totalBytes) return { ok: false, reason: "full" };
    return { ok: true, body, held, t, day, grows };
  };

  /** Keeps a log that matched: makes room on a full shelf, writes it, and spends its sender's bytes. */
  const commit = (log: PublishedLog, plan: Plan, from: string): PublishResult => {
    const { body, held, t, day, grows } = plan;
    // a full shelf lets go the diaries quiet longest (published or read longest ago), never this pet's (A80)
    if (body.length - (held?.bytes ?? 0) + total > totalBytes) {
      const others = [...index].filter(([id]) => id !== log.petId).sort((x, y) => x[1].at - y[1].at);
      let free = totalBytes - total + (held?.bytes ?? 0);
      const go: string[] = [];
      for (const [id, e] of others) {
        if (free >= body.length) break;
        go.push(id);
        free += e.bytes;
      }
      if (free < body.length) return { ok: false, reason: "full" };
      for (const id of go) {
        total -= index.get(id)!.bytes;
        index.delete(id);
        if (dir) rmSync(file(id), { force: true });
        else texts.delete(id);
      }
    }
    if (dir) {
      writeFlushed(`${file(log.petId)}.tmp`, body);
      // the file keeps the store's own time, as a read does, so a restart orders the shelf on one clock (A80)
      utimesSync(`${file(log.petId)}.tmp`, t / 1000, t / 1000);
      renameSync(`${file(log.petId)}.tmp`, file(log.petId));
    } else texts.set(log.petId, body);
    total += body.length - (held?.bytes ?? 0);
    index.set(log.petId, { bytes: body.length, words: log.words.length, at: t });
    addSpent(from, day, grows);
    return { ok: true, beats: log.words.length };
  };

  return {
    /** A kept log, parsed now and not kept in memory (tests and the publish check). */
    get: read,
    /** Where a kept log is, to stream it: its file, or (with no folder) its text. */
    where(id: string): { file: string } | { text: string } | null {
      if (!ID.test(id) || !index.has(id)) return null;
      // a diary read keeps its place on the shelf, on its file's time too (at most once a minute) so a restart keeps it
      const e = index.get(id)!;
      const at = now();
      if (at - e.at > TOUCH_MS) {
        index.set(id, { ...e, at });
        if (dir) {
          try {
            utimesSync(file(id), at / 1000, at / 1000);
          } catch {
            // the time on disk only orders a restart
          }
        }
      }
      if (dir) return { file: file(id) };
      const t = texts.get(id);
      return t === undefined ? null : { text: t };
    },
    /**
     * Keep a log once it matches the chain's saved hash and every bound holds; a shorter log never replaces a longer
     * one. Every cheap bound is checked before the hash is worked out (A114), the hash runs where `hash` runs it (a
     * worker on the server), and the bounds are checked again after it, since another publish may have landed while it
     * ran. A log that does not match still spends its sender's daily bytes: junk costs the one who sends it.
     */
    async publishLog(
      log: PublishedLog,
      chain: PetOnChain | null,
      from: string,
      hash: (words: readonly number[], who?: string) => Promise<string | null>,
    ): Promise<PublishResult> {
      const first = check(log, chain, from);
      if (!first.ok) return first;
      const got = await hash(log.words, from);
      if (got === null) return { ok: false, reason: "busy" };
      if (got.toLowerCase() !== chain!.logHash.toLowerCase()) {
        charge(from, Math.max(MIN_MISMATCH_CHARGE, first.body.length));
        return { ok: false, reason: "mismatch" };
      }
      const again = check(log, chain, from);
      if (!again.ok) return again;
      return commit(log, again, from);
    },
    /** The same, from an unchecked body and with the hash on this thread (tests and tools). */
    publish(raw: unknown, chain: PetOnChain | null, from: string): PublishResult {
      const parsed = PublishedLog.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: "invalid" };
      const log = parsed.data;
      const first = check(log, chain, from);
      if (!first.ok) return first;
      if (chainAll(ZERO_HASH, log.words).toLowerCase() !== chain!.logHash.toLowerCase()) {
        charge(from, Math.max(MIN_MISMATCH_CHARGE, first.body.length));
        return { ok: false, reason: "mismatch" };
      }
      return commit(log, first, from);
    },
    /** How many logs are held in memory: none with a folder (A39). */
    heldInMemory: () => texts.size,
    /** what is shelved, and how many senders (and IPv6 /48s) today's spending holds */
    stats: () => ({ diaries: index.size, bytes: total, spenders: spent.size }),
  };
}
export type DiaryStore = ReturnType<typeof createDiaryStore>;
