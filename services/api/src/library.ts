/**
 * The lesson library (T4, T5): lessons players chose to share, with how many pets
 * learned each one and the pet that taught it first. A lesson is a rule in the
 * pet's own vocabulary, so what other players see is built from that structure
 * (chips), never from free text; the only words shown are the first teacher pet's
 * name, checked like an on-chain name and against the words rooms refuse; a label
 * a client sends is dropped, never stored. Players can report a lesson: it is
 * hidden once reports from different players (an IPv6 /48 is one) reach five and a third of the
 * players who learned it, so a few addresses cannot bury a lesson many learned.
 *
 * A full library always makes room (A64, A79): a new share first removes a hidden lesson, else the lesson the fewest
 * players learned, the one quiet longest among those, so keeping a lesson takes real learners, not one friend, and a
 * lesson many learned is the last to go. One sharer holds at most MAX_PER_SHARER lessons nobody else learned: past
 * that, their own oldest goes.
 */

import { createHash } from "node:crypto";
import type { Rule } from "@lingxi/brain";
import { checkLesson } from "@lingxi/game";
import { SeenBits, type SeenSet, emptySeen, seenFrom } from "./seenSet";
import { BLOCKED_WORDS } from "./words";
import { prefixOf } from "./limit";
import { hasStore, readStore, saveJson } from "./durable";
import { pseudonym, scrubAsides } from "./pseudonym";
import { basename, dirname } from "node:path";

export interface LibraryEntry {
  key: string;
  rule: Rule;
  /** the pet that shared it first */
  by: string;
  firstAt: number;
  uses: number;
  /**
   * who reported it, as keyed ids (never the raw address), in a set of fixed size: compact in memory (SeenBits, P10), and
   * written to the file as the SeenSet it always was
   */
  reports: SeenBits;
  reportCount: number;
  /** who already counted a use, so one player can't inflate it, in a set of fixed size (as `reports`) */
  users: SeenBits;
  /** who shared it, as a keyed id; absent on lessons shared before it was kept */
  from?: string;
  /** "keyed" once its ids are keyed codes (P6a); absent on a lesson kept before, whose ids are coded on load */
  ids?: "keyed";
  /** when it was last shared or learned (A79); absent on lessons kept before, which count from `firstAt` */
  lastAt?: number;
}

/** The store is written this long after the last change, once a burst of changes is over. */
const SAVE_DELAY_MS = 2_000;

const MAX_ENTRIES = 5000;
/** The most lessons one sharer holds that nobody else learned (A64). */
const MAX_PER_SHARER = 50;
/** Reports from different players (an IPv6 /48 is one) that hide a lesson, at the least (A120). */
const HIDE_AT = 5;
/** ...and at least this share of the players who learned it. */
const HIDE_SHARE = 1 / 3;

/** The same rule however its fields are ordered: what makes two shares one lesson. */
export function lessonKey(rule: Pick<Rule, "when" | "then">): string {
  const when = Object.keys(rule.when)
    .sort()
    .map((k) => [k, [...rule.when[k]!].sort((a, b) => a - b)]);
  const then = {
    want: rule.then.want,
    mood: rule.then.mood,
    ...(rule.then.nudge !== undefined ? { nudge: rule.then.nudge } : {}),
  };
  return createHash("sha256").update(JSON.stringify({ when, then })).digest("hex").slice(0, 24);
}

/** Pet names shown to others: like on-chain names, plus no control or hidden characters. */
export function cleanAuthor(name: string): string | null {
  const n = name.trim();
  if (!n || new TextEncoder().encode(n).length > 24 || BLOCKED_WORDS.test(n)) return null;
  for (const ch of n) {
    const cp = ch.codePointAt(0)!;
    if (
      cp < 0x20 ||
      cp === 0x7f ||
      '"\\<>&'.includes(ch) ||
      (cp >= 0x80 && cp <= 0xa0) ||
      (cp >= 0x2000 && cp <= 0x206f) ||
      cp === 0xfeff ||
      cp === 0xad
    )
      return null;
  }
  return n;
}

/** The id a player had before ids were keyed: a plain hash, which anyone can work out for a guessed address. */
const plainId = (id: string) =>
  createHash("sha256")
    .update(`lingxi-library:${prefixOf(id) ?? id}`)
    .digest("hex")
    .slice(0, 16);
/** A plain id as the keyed id the same player has now (P6a). */
const keyedFrom = (plain: string) => pseudonym("library", plain);

/**
 * A player as the library counts them: an IPv6 caller is its /48, so one network is one learner and one reporter
 * (A120). The id is keyed with the server's address key (pseudonym.ts), so it cannot be checked against a guessed
 * address; it is the keyed code of the plain id a player had before, so ids kept then are coded into the same ids.
 */
export const hashId = (id: string) => keyedFrom(plainId(id));

/** A set kept before ids were keyed, its ids keyed; a filter cannot be, and is marked to be read by plain ids too. */
function keyedSet(s: SeenSet): SeenSet {
  if (!s.bloom) return { ids: s.ids.map(keyedFrom), bloom: null };
  return { ...s, legacy: true };
}

/** Whether `who` is in `s`, by its keyed id or, in a filter filled before ids were keyed, by its plain id. */
const seenIn = (s: SeenBits, who: string) => s.has(hashId(who)) || (s.legacy && s.has(plainId(who)));

/** A set holding `id` alone. */
const seenBy = (id: string): SeenBits => {
  const b = SeenBits.from(emptySeen());
  b.add(id);
  return b;
};

export function createLibrary(store?: string, limits: { max?: number; perSharer?: number } = {}) {
  const max = limits.max ?? MAX_ENTRIES;
  const perSharer = limits.perSharer ?? MAX_PER_SHARER;
  const entries = new Map<string, LibraryEntry>();
  let plain = false;
  if (store && hasStore(store)) {
    try {
      // labels stored before they were dropped are dropped on load, and plain lists become fixed-size sets
      for (const e of readStore(store) as Array<
        Omit<LibraryEntry, "reports" | "users"> & { reports: unknown; users: unknown }
      >) {
        let reports = seenFrom(e.reports);
        let users = seenFrom(e.users);
        let from = e.from;
        // ids kept before they were keyed are keyed now (P6a), so each player keeps counting once
        if (e.ids !== "keyed") {
          plain = true;
          reports = keyedSet(reports);
          users = keyedSet(users);
          if (from !== undefined) from = keyedFrom(from);
        }
        const reportCount =
          typeof e.reportCount === "number" ? e.reportCount : Array.isArray(e.reports) ? e.reports.length : 0;
        entries.set(e.key, {
          ...e,
          rule: { when: e.rule.when, then: e.rule.then } as Rule,
          reports: SeenBits.from(reports),
          reportCount,
          users: SeenBits.from(users),
          ...(from !== undefined ? { from } : {}),
          ids: "keyed",
        });
      }
    } catch {
      // a damaged file starts empty
    }
  }
  if (store && plain) {
    // written twice, so the .bak each write keeps holds no plain id either
    try {
      for (let i = 0; i < 2; i++) saveJson(store, undefined, JSON.stringify([...entries.values()]));
    } catch (e) {
      process.stderr.write(`library not saved: ${(e as Error).message}\n`);
    }
  }
  if (store) scrubAsides(dirname(store), basename(store));
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (!store || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        saveJson(store, undefined, JSON.stringify([...entries.values()]));
      } catch (e) {
        process.stderr.write(`library not saved: ${(e as Error).message}\n`);
      }
    }, SAVE_DELAY_MS);
    timer.unref?.();
  };
  const visible = (e: LibraryEntry) => e.reportCount < Math.max(HIDE_AT, Math.ceil(e.uses * HIDE_SHARE));
  // a name stored before the word check is shown as no name
  const view = (e: LibraryEntry) => ({
    key: e.key,
    rule: e.rule,
    by: cleanAuthor(e.by) ?? "",
    uses: e.uses,
    firstAt: e.firstAt,
  });

  /** a lesson nobody but its sharer learned */
  const solo = (e: LibraryEntry) => e.uses <= 1;
  const oldest = (list: LibraryEntry[]) =>
    list.reduce<LibraryEntry | null>((a, e) => (!a || e.firstAt < a.firstAt ? e : a), null);
  const quiet = (e: LibraryEntry) => e.lastAt ?? e.firstAt;
  /** What a new share from `from` removes to fit, if anything (A64, A79): there is always room. */
  const roomFor = (from: string): { ok: true; drop: string | null } | { ok: false } => {
    const all = [...entries.values()];
    const mine = all.filter((e) => e.from === from && solo(e));
    if (mine.length >= perSharer) return { ok: true, drop: oldest(mine)!.key };
    if (entries.size < max) return { ok: true, drop: null };
    const hidden = oldest(all.filter((e) => !visible(e)));
    if (hidden) return { ok: true, drop: hidden.key };
    // the fewest learners, then the quietest: two addresses can no longer hold a lesson against everyone else
    const least = all.reduce<LibraryEntry | null>(
      (a, e) => (!a || e.uses < a.uses || (e.uses === a.uses && quiet(e) < quiet(a)) ? e : a),
      null,
    );
    return least ? { ok: true, drop: least.key } : { ok: false };
  };

  return {
    size: () => entries.size,
    has: (key: string) => entries.has(key),
    /** Share a lesson (or count as a use if it is already there). */
    share(
      rule: Rule,
      by: string,
      who: string,
      now: number,
    ): { ok: true; key: string; isNew: boolean } | { ok: false; reason: "invalid" | "name" | "full" } {
      const author = cleanAuthor(by);
      if (!author) return { ok: false, reason: "name" };
      // it must be a lesson some pet can actually hold
      const check = checkLesson("gentle", "adult", [], rule);
      if (!check.ok) return { ok: false, reason: "invalid" };
      const key = lessonKey(rule);
      const have = entries.get(key);
      if (have) {
        this.use(key, who, now);
        return { ok: true, key, isNew: false };
      }
      const from = hashId(who);
      const room = roomFor(from);
      if (!room.ok) return { ok: false, reason: "full" };
      if (room.drop) entries.delete(room.drop);
      entries.set(key, {
        key,
        rule: { when: rule.when, then: rule.then } as Rule,
        by: author,
        firstAt: now,
        uses: 1,
        reports: SeenBits.from(emptySeen()),
        reportCount: 0,
        users: seenBy(from),
        from,
        lastAt: now,
        ids: "keyed",
      });
      save();
      return { ok: true, key, isNew: true };
    },
    /** A pet learned it from the library: one count per player per lesson. */
    use(key: string, who: string, now = Date.now()): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const h = hashId(who);
      if (seenIn(e.users, who)) return true;
      // the set changes in place: it is this record's alone (SeenBits)
      e.users.add(h);
      entries.set(key, { ...e, uses: e.uses + 1, lastAt: now });
      save();
      return true;
    },
    report(key: string, who: string): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const h = hashId(who);
      if (!seenIn(e.reports, who)) {
        e.reports.add(h);
        entries.set(key, { ...e, reportCount: e.reportCount + 1 });
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
