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

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PublishedLog } from "@lingxi/api-schema";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import { ZERO_HASH, chainAll } from "@lingxi/game";

/** Words a pet's log may hold for each minute it has lived: one a beat, the rest care (a player would have to tap nine times a minute, all its life). */
export const DIARY_WORDS_PER_MINUTE = 10;
/** The fewest words any pet's log may hold, whatever its age: a first hour of play. */
export const DIARY_FLOOR_WORDS = 5_000;
/** What the shelf holds in all, and what one address may publish in a day (bytes of stored JSON). */
const TOTAL_BYTES = 256 * 1024 * 1024;
const PER_ADDRESS_BYTES_PER_DAY = 16 * 1024 * 1024;
const DAY_MS = 86_400_000;
const ID = /^\d{1,12}$/;

export type PublishResult = { ok: true; beats: number } | { ok: false; reason: "invalid" | "mismatch" | "unknown" | "older" | "tooLong" | "busy" | "full" };

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
export const diaryMaxWords = (born: number, now: number) => Math.min(SEND_LIMITS.logWords, Math.max(DIARY_FLOOR_WORDS, Math.ceil(Math.max(0, now / 1000 - born) / 60) * DIARY_WORDS_PER_MINUTE));

export function createDiaryStore(dir?: string, opts: { now?: () => number; totalBytes?: number; perAddressBytesPerDay?: number } = {}) {
  const now = opts.now ?? Date.now;
  const totalBytes = opts.totalBytes ?? TOTAL_BYTES;
  const perAddress = opts.perAddressBytesPerDay ?? PER_ADDRESS_BYTES_PER_DAY;
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = (id: string) => join(dir!, `${id}.json`);
  /** what is kept, by pet: its size and words (never its words themselves) */
  const index = new Map<string, { bytes: number; words: number }>();
  /** without a folder (tests), the logs' text */
  const texts = new Map<string, string>();
  let total = 0;
  if (dir) {
    for (const name of readdirSync(dir)) {
      const id = name.replace(/\.json$/, "");
      if (!ID.test(id) || !name.endsWith(".json")) continue;
      try {
        const parsed = PublishedLog.parse(JSON.parse(readFileSync(join(dir, name), "utf8")));
        const bytes = statSync(join(dir, name)).size;
        index.set(id, { bytes, words: parsed.words.length });
        total += bytes;
      } catch {
        // a damaged file is not served, and not counted
      }
    }
  }
  const spent = new Map<string, { day: number; bytes: number }>();

  const text = (id: string): string | null => {
    if (!index.has(id)) return null;
    if (!dir) return texts.get(id) ?? null;
    try {
      return readFileSync(file(id), "utf8");
    } catch {
      return null;
    }
  };

  return {
    /** A kept log, parsed now and not kept in memory (tests and the publish check). */
    get(id: string): PublishedLog | null {
      const t = text(id);
      if (t === null) return null;
      try {
        return PublishedLog.parse(JSON.parse(t));
      } catch {
        return null;
      }
    },
    /** Where a kept log is, to stream it: its file, or (with no folder) its text. */
    where(id: string): { file: string } | { text: string } | null {
      if (!ID.test(id) || !index.has(id)) return null;
      if (dir) return { file: file(id) };
      const t = texts.get(id);
      return t === undefined ? null : { text: t };
    },
    /** Keep a log once it matches the chain's saved hash and every bound holds; a shorter log never replaces a longer one. */
    publish(raw: unknown, chain: PetOnChain | null, from: string): PublishResult {
      const parsed = PublishedLog.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: "invalid" };
      const log = parsed.data;
      const joined = log.segments.flatMap((s) => s.words);
      if (joined.length !== log.words.length || joined.some((w, i) => w !== log.words[i])) return { ok: false, reason: "invalid" };
      if (!chain) return { ok: false, reason: "unknown" };
      const t = now();
      if (log.words.length > diaryMaxWords(chain.born, chain.at !== undefined ? chain.at * 1000 : t)) return { ok: false, reason: "tooLong" };
      if (chainAll(ZERO_HASH, log.words).toLowerCase() !== chain.logHash.toLowerCase()) return { ok: false, reason: "mismatch" };
      const held = index.get(log.petId);
      if (held && held.words > log.words.length) return { ok: false, reason: "older" };
      const body = JSON.stringify(log);
      const grows = Math.max(0, body.length - (held?.bytes ?? 0));
      const day = Math.floor(t / DAY_MS);
      const mine = spent.get(from);
      const today = mine?.day === day ? mine.bytes : 0;
      if (today + grows > perAddress) return { ok: false, reason: "busy" };
      if (total + grows > totalBytes) return { ok: false, reason: "full" };
      if (dir) {
        writeFileSync(`${file(log.petId)}.tmp`, body);
        renameSync(`${file(log.petId)}.tmp`, file(log.petId));
      } else texts.set(log.petId, body);
      total += body.length - (held?.bytes ?? 0);
      index.set(log.petId, { bytes: body.length, words: log.words.length });
      spent.set(from, { day, bytes: today + grows });
      return { ok: true, beats: log.words.length };
    },
    /** How many logs are held in memory: none with a folder (A39). */
    heldInMemory: () => texts.size,
    stats: () => ({ diaries: index.size, bytes: total }),
  };
}
export type DiaryStore = ReturnType<typeof createDiaryStore>;
