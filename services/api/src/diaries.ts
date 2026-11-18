/**
 * Public diaries (PRD Z1): an owner publishes the log their pet's last checkpoint
 * committed to, so the pet's public page can show its diary to anyone. A log is
 * kept only if its hash chain equals the log hash saved on chain for that pet, so
 * nothing here can put words in a pet's mouth; the page checks it again itself.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { SEND_LIMITS } from "@lingxi/chain/limits";

/** The most beats one published log may hold (about 70 days of minutes). */
export const MAX_LOG_WORDS = SEND_LIMITS.logWords;

const Word = z.number().int().min(0).max(65535);
export const PublishedLog = z.object({
  petId: z.string().regex(/^\d{1,12}$/),
  words: z.array(Word).min(1).max(MAX_LOG_WORDS),
  segments: z.array(z.object({ brainId: z.string().regex(/^\d{1,20}$/).nullable(), words: z.array(Word).max(MAX_LOG_WORDS) })).min(1).max(64),
});
export type PublishedLog = z.infer<typeof PublishedLog>;

export type PublishResult = { ok: true; beats: number } | { ok: false; reason: "invalid" | "mismatch" | "unknown" | "older" };

export function createDiaryStore(dir?: string) {
  const mem = new Map<string, PublishedLog>();
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = (id: string) => join(dir!, `${id}.json`);
  return {
    get(id: string): PublishedLog | null {
      const held = mem.get(id);
      if (held) return held;
      if (!dir || !existsSync(file(id))) return null;
      try {
        const v = PublishedLog.parse(JSON.parse(readFileSync(file(id), "utf8")));
        mem.set(id, v);
        return v;
      } catch {
        return null;
      }
    },
    /** Keep a log once it matches the chain's saved hash; a shorter log never replaces a longer one. */
    publish(raw: unknown, chainLogHash: string | null): PublishResult {
      const parsed = PublishedLog.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: "invalid" };
      const log = parsed.data;
      const joined = log.segments.flatMap((s) => s.words);
      if (joined.length !== log.words.length || joined.some((w, i) => w !== log.words[i])) return { ok: false, reason: "invalid" };
      if (!chainLogHash) return { ok: false, reason: "unknown" };
      if (chainAll(ZERO_HASH, log.words).toLowerCase() !== chainLogHash.toLowerCase()) return { ok: false, reason: "mismatch" };
      const held = this.get(log.petId);
      if (held && held.words.length > log.words.length) return { ok: false, reason: "older" };
      mem.set(log.petId, log);
      if (dir) {
        writeFileSync(`${file(log.petId)}.tmp`, JSON.stringify(log));
        renameSync(`${file(log.petId)}.tmp`, file(log.petId));
      }
      return { ok: true, beats: log.words.length };
    },
  };
}
export type DiaryStore = ReturnType<typeof createDiaryStore>;
