/**
 * The lesson library (T4, T5): lessons players chose to share, with how many pets
 * learned each one and the pet that taught it first. A lesson is a rule in the
 * pet's own vocabulary, so what other players see is built from that structure
 * (chips), never from free text; the only words shown are the first teacher pet's
 * name, checked like an on-chain name and against the words rooms refuse; a label
 * a client sends is dropped, never stored. Players can report a lesson: it is
 * hidden once reports from different addresses reach three and a third of the
 * players who learned it, so a few addresses cannot bury a lesson many learned.
 *
 * A full library makes room rather than closing (A64): a new share first removes a hidden lesson, then the oldest
 * lesson nobody but its sharer learned; it is refused only when every lesson has been learned by someone else. One
 * sharer holds at most MAX_PER_SHARER lessons nobody else learned: past that, their own oldest goes. A lesson others
 * learned is never removed.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Rule } from "@lingxi/brain";
import { checkLesson } from "@lingxi/game";
import { type SeenSet, addSeen, emptySeen, hasSeen, seenFrom } from "./seenSet";
import { BLOCKED_WORDS } from "./words";

export interface LibraryEntry {
  key: string;
  rule: Rule;
  /** the pet that shared it first */
  by: string;
  firstAt: number;
  uses: number;
  /** who reported it, as hashed ids (never the raw address), in a set of fixed size */
  reports: SeenSet;
  reportCount: number;
  /** who already counted a use, so one player can't inflate it, in a set of fixed size */
  users: SeenSet;
  /** who shared it, as a hashed id; absent on lessons shared before it was kept */
  from?: string;
}

/** The store is written this long after the last change, once a burst of changes is over. */
const SAVE_DELAY_MS = 2_000;

const MAX_ENTRIES = 5000;
/** The most lessons one sharer holds that nobody else learned (A64). */
const MAX_PER_SHARER = 50;
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

export function createLibrary(store?: string, limits: { max?: number; perSharer?: number } = {}) {
  const max = limits.max ?? MAX_ENTRIES;
  const perSharer = limits.perSharer ?? MAX_PER_SHARER;
  const entries = new Map<string, LibraryEntry>();
  if (store && existsSync(store)) {
    try {
      // labels stored before they were dropped are dropped on load, and plain lists become fixed-size sets
      for (const e of JSON.parse(readFileSync(store, "utf8")) as Array<LibraryEntry & { reports: unknown; users: unknown }>) {
        const reports = seenFrom(e.reports);
        const reportCount = typeof e.reportCount === "number" ? e.reportCount : Array.isArray(e.reports) ? e.reports.length : 0;
        entries.set(e.key, { ...e, rule: { when: e.rule.when, then: e.rule.then } as Rule, reports, reportCount, users: seenFrom(e.users) });
      }
    } catch {
      // a damaged file starts empty
    }
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (!store || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        writeFileSync(`${store}.tmp`, JSON.stringify([...entries.values()]));
        renameSync(`${store}.tmp`, store);
      } catch (e) {
        process.stderr.write(`library not saved: ${(e as Error).message}\n`);
      }
    }, SAVE_DELAY_MS);
    timer.unref?.();
  };
  const visible = (e: LibraryEntry) => e.reportCount < Math.max(HIDE_AT, Math.ceil(e.uses * HIDE_SHARE));
  // a name stored before the word check is shown as no name
  const view = (e: LibraryEntry) => ({ key: e.key, rule: e.rule, by: cleanAuthor(e.by) ?? "", uses: e.uses, firstAt: e.firstAt });

  /** a lesson nobody but its sharer learned */
  const solo = (e: LibraryEntry) => e.uses <= 1;
  const oldest = (list: LibraryEntry[]) => list.reduce<LibraryEntry | null>((a, e) => (!a || e.firstAt < a.firstAt ? e : a), null);
  /** What a new share from `from` removes to fit, if anything; not ok when nothing may go (A64). */
  const roomFor = (from: string): { ok: true; drop: string | null } | { ok: false } => {
    const all = [...entries.values()];
    const mine = all.filter((e) => e.from === from && solo(e));
    if (mine.length >= perSharer) return { ok: true, drop: oldest(mine)!.key };
    if (entries.size < max) return { ok: true, drop: null };
    const victim = oldest(all.filter((e) => !visible(e))) ?? oldest(all.filter(solo));
    return victim ? { ok: true, drop: victim.key } : { ok: false };
  };

  return {
    size: () => entries.size,
    has: (key: string) => entries.has(key),
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
      const from = hashId(who);
      const room = roomFor(from);
      if (!room.ok) return { ok: false, reason: "full" };
      if (room.drop) entries.delete(room.drop);
      entries.set(key, { key, rule: { when: rule.when, then: rule.then } as Rule, by: author, firstAt: now, uses: 1, reports: emptySeen(), reportCount: 0, users: addSeen(emptySeen(), from), from });
      save();
      return { ok: true, key, isNew: true };
    },
    /** A pet learned it from the library: one count per player per lesson. */
    use(key: string, who: string): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const h = hashId(who);
      if (hasSeen(e.users, h)) return true;
      entries.set(key, { ...e, users: addSeen(e.users, h), uses: e.uses + 1 });
      save();
      return true;
    },
    report(key: string, who: string): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const h = hashId(who);
      if (!hasSeen(e.reports, h)) {
        entries.set(key, { ...e, reports: addSeen(e.reports, h), reportCount: e.reportCount + 1 });
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
