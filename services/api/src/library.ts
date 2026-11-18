/**
 * The lesson library (T4, T5): lessons players chose to share, with how many pets
 * learned each one and the pet that taught it first. A lesson is a rule in the
 * pet's own vocabulary, so what other players see is built from that structure
 * (chips), never from free text; the only words shown are the first teacher pet's
 * name, checked like an on-chain name and against the words rooms refuse; a label
 * a client sends is dropped, never stored. Players can report a lesson: it is
 * hidden once reports from different addresses reach three and a third of the
 * players who learned it, so a few addresses cannot bury a lesson many learned.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { Rule } from "@lingxi/brain";
import { checkLesson } from "@lingxi/game";
import { BLOCKED_WORDS } from "./words";

export const LibraryRule = z.object({
  when: z.record(z.string().max(24), z.array(z.number().int().min(0).max(15)).min(1).max(16)),
  then: z.object({ want: z.number().int().min(0).max(15), mood: z.number().int().min(0).max(3), nudge: z.number().int().min(0).max(15).optional() }),
  /** accepted from older clients and dropped: the library shows no stranger's words */
  label: z.string().max(60).optional(),
});

export interface LibraryEntry {
  key: string;
  rule: Rule;
  /** the pet that shared it first */
  by: string;
  firstAt: number;
  uses: number;
  /** hashed reporter ids (never the raw IP) */
  reports: string[];
  /** hashed ids that already counted a use, so one player can't inflate it */
  users: string[];
}

const MAX_ENTRIES = 5000;
/** Reports from different addresses that hide a lesson, at the least. */
const HIDE_AT = 3;
/** ...and at least this share of the players who learned it. */
const HIDE_SHARE = 1 / 3;

/** The same rule however its fields are ordered: what makes two shares one lesson. */
export function lessonKey(rule: Pick<Rule, "when" | "then">): string {
  const when = Object.keys(rule.when)
    .sort()
    .map((k) => [k, [...rule.when[k]!].sort((a, b) => a - b)]);
  const then = { want: rule.then.want, mood: rule.then.mood, ...(rule.then.nudge !== undefined ? { nudge: rule.then.nudge } : {}) };
  return createHash("sha256").update(JSON.stringify({ when, then })).digest("hex").slice(0, 24);
}

/** Pet names shown to others: like on-chain names, plus no control or hidden characters. */
export function cleanAuthor(name: string): string | null {
  const n = name.trim();
  if (!n || new TextEncoder().encode(n).length > 24 || BLOCKED_WORDS.test(n)) return null;
  for (const ch of n) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f || '"\\<>&'.includes(ch) || (cp >= 0x80 && cp <= 0xa0) || (cp >= 0x2000 && cp <= 0x206f) || cp === 0xfeff || cp === 0xad) return null;
  }
  return n;
}

export const hashId = (id: string) => createHash("sha256").update(`lingxi-library:${id}`).digest("hex").slice(0, 16);

export function createLibrary(store?: string) {
  const entries = new Map<string, LibraryEntry>();
  if (store && existsSync(store)) {
    try {
      // labels stored before they were dropped are dropped on load
      for (const e of JSON.parse(readFileSync(store, "utf8")) as LibraryEntry[]) entries.set(e.key, { ...e, rule: { when: e.rule.when, then: e.rule.then } as Rule });
    } catch {
      // a damaged file starts empty
    }
  }
  const save = () => {
    if (!store) return;
    writeFileSync(`${store}.tmp`, JSON.stringify([...entries.values()]));
    renameSync(`${store}.tmp`, store);
  };
  const visible = (e: LibraryEntry) => e.reports.length < Math.max(HIDE_AT, Math.ceil(e.uses * HIDE_SHARE));
  // a name stored before the word check is shown as no name
  const view = (e: LibraryEntry) => ({ key: e.key, rule: e.rule, by: cleanAuthor(e.by) ?? "", uses: e.uses, firstAt: e.firstAt });

  return {
    size: () => entries.size,
    /** Share a lesson (or count as a use if it is already there). */
    share(rule: Rule, by: string, who: string, now: number): { ok: true; key: string; isNew: boolean } | { ok: false; reason: "invalid" | "name" | "full" } {
      const author = cleanAuthor(by);
      if (!author) return { ok: false, reason: "name" };
      // it must be a lesson some pet can actually hold
      const check = checkLesson("gentle", "adult", [], rule);
      if (!check.ok) return { ok: false, reason: "invalid" };
      const key = lessonKey(rule);
      const have = entries.get(key);
      if (have) {
        this.use(key, who);
        return { ok: true, key, isNew: false };
      }
      if (entries.size >= MAX_ENTRIES) return { ok: false, reason: "full" };
      entries.set(key, { key, rule: { when: rule.when, then: rule.then } as Rule, by: author, firstAt: now, uses: 1, reports: [], users: [hashId(who)] });
      save();
      return { ok: true, key, isNew: true };
    },
    /** A pet learned it from the library: one count per player per lesson. */
    use(key: string, who: string): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const h = hashId(who);
      if (e.users.includes(h)) return true;
      e.users.push(h);
      e.uses++;
      save();
      return true;
    },
    report(key: string, who: string): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const h = hashId(who);
      if (!e.reports.includes(h)) {
        e.reports.push(h);
        save();
      }
      return true;
    },
    /** Most-learned first (ties: newest first). */
    list(limit = 40) {
      return [...entries.values()]
        .filter(visible)
        .sort((a, b) => b.uses - a.uses || b.firstAt - a.firstAt)
        .slice(0, limit)
        .map(view);
    },
  };
}
export type Library = ReturnType<typeof createLibrary>;
