/**
 * Gentle reminders by web push. The game works out when the pet will next need
 * its player (packages/game reminders) and sends this server a short plan; at
 * each time the server sends one notification, never more than one every three
 * hours, and never at night on the player's own clock (it waits until 8:00).
 *
 * Only real push services are contacted (the browser's own endpoint, checked
 * against the known push hosts), so a plan can't make this server call any
 * other address.
 *
 * P10: each subscription is kept in a file of its own, and memory holds only what scheduling needs of it (when its next
 * reminder is due, when one was last sent, its planner's codes): 20,000 subscriptions held whole took 39 MB, and every
 * plan rewrote all of them at once. A subscription's endpoint and keys are read from its file when a reminder is sent.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CODE, type Coded, codeOf, heldOverCoded, recoded, scrubAsides } from "./pseudonym";
import webpush from "web-push";
import type { PushPlanBody } from "@lingxi/api-schema";
import { hasStore, readStore, writeFlushed } from "./durable";

export type ReminderKind = "hungry" | "bored" | "dirty" | "sick";

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^android\.googleapis\.com$/,
];
const MAX_SUBS = 20_000;
/** Subscriptions one address may hold (its devices); an IPv6 /48 holds four addresses' worth (A83). */
export const MAX_DEVICES_PER_ADDRESS = 8;
const HORIZON_MS = 48 * 3_600_000;
const MIN_GAP_MS = 3 * 3_600_000;
const QUIET_FROM = 22;
const QUIET_TO = 8;

/** A plan as the game sends it and the server checks it (@lingxi/api-schema PushPlanBody). */
export type Plan = PushPlanBody;

interface Entry {
  sub: Plan["subscription"];
  lang: Plan["lang"];
  name: string;
  tz: number;
  reminders: Array<{ kind: ReminderKind; at: number }>;
  lastSent: number;
  /**
   * the code of the address that planned it (A83; never the address, P6a); entries kept before this have none and count
   * against no one
   */
  by?: string;
  /** the code of that address's IPv6 /48, when it has one */
  net?: string;
}

export const isPushEndpoint = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
};

/** Moves a time that falls in the player's night (22:00-8:00 local) to 8:00 the next morning. */
export function outOfQuietHours(at: number, tzMin: number): number {
  const local = new Date(at + tzMin * 60_000);
  const h = local.getUTCHours();
  if (h >= QUIET_TO && h < QUIET_FROM) return at;
  const morning = new Date(local);
  if (h >= QUIET_FROM) morning.setUTCDate(morning.getUTCDate() + 1);
  morning.setUTCHours(QUIET_TO, 0, 0, 0);
  return morning.getTime() - tzMin * 60_000;
}

const TEXT: Record<Plan["lang"], Record<ReminderKind, (n: string) => [string, string]>> = {
  en: {
    hungry: (n) => [`${n} is getting hungry`, "A snack now keeps the day a good one."],
    bored: (n) => [`${n} is a little bored`, "Come and play for a minute?"],
    dirty: (n) => [`${n} could use a wash`, "A quick clean keeps it from getting ill."],
    sick: (n) => [`${n} isn't feeling well`, "It needs medicine and some care."],
  },
  zh: {
    hungry: (n) => [`${n}有点饿了`, "现在喂点零食，今天就还是开心的一天。"],
    bored: (n) => [`${n}有点无聊`, "来陪它玩一会儿吧？"],
    dirty: (n) => [`${n}该洗洗了`, "洗干净就不容易生病。"],
    sick: (n) => [`${n}不太舒服`, "它需要吃药，也需要你陪陪它。"],
  },
};

export function reminderText(kind: ReminderKind, lang: Plan["lang"], name: string): { title: string; body: string } {
  const [title, body] = TEXT[lang][kind](name);
  return { title, body };
}

export interface Pusher {
  publicKey: string;
  plan: (p: Plan, now: number, from?: string) => { ok: true } | { ok: false; reason: string };
  stop: (endpoint: string) => boolean;
  /** send whatever is due; returns how many were sent */
  tick: (now: number) => Promise<number>;
  size: () => number;
}

type Send = (sub: Plan["subscription"], payload: string) => Promise<{ gone: boolean }>;

/**
 * What scheduling needs of a subscription (P10), all memory holds of it when there is a store: when its next reminder
 * is due, when one was last sent, and the codes of its planner. The rest is in its own file.
 */
interface Slot {
  next: number;
  lastSent: number;
  by?: string;
  net?: string;
}

const plannerOf = (s: Slot): Coded[] =>
  s.by === undefined ? [] : [s.net !== undefined ? { by: s.by, net: s.net } : { by: s.by }];

/** a subscription's name in memory and on disk: a digest of its endpoint, which may be 800 characters */
const idOf = (endpoint: string) => createHash("sha256").update(endpoint).digest().subarray(0, 16).toString("hex");

/**
 * Each subscription whole (P10): its endpoint and keys, language, pet's name, time zone and reminders. With a folder, a
 * file of its own there, written when it is planned and read when one of its reminders is due, so no plan rewrites
 * every subscription; without one (tests), held in memory.
 */
function entryShelf(dir: string | null) {
  const held = new Map<string, Entry>();
  const path = (id: string) => join(dir ?? "", `${id}.json`);
  if (dir) mkdirSync(dir, { recursive: true });
  return {
    put(id: string, e: Entry): void {
      if (!dir) {
        held.set(id, e);
        return;
      }
      writeFlushed(`${path(id)}.tmp`, JSON.stringify(e));
      renameSync(`${path(id)}.tmp`, path(id));
    },
    get(id: string): Entry | null {
      if (!dir) return held.get(id) ?? null;
      try {
        return JSON.parse(readFileSync(path(id), "utf8")) as Entry;
      } catch (e) {
        process.stderr.write(`reminder ${id} not read: ${(e as Error).message}\n`);
        return null;
      }
    },
    has(id: string): boolean {
      return dir ? existsSync(path(id)) : held.has(id);
    },
    remove(id: string): void {
      held.delete(id);
      if (dir) rmSync(path(id), { force: true });
    },
    /** the ids of the subscriptions kept, each file a write cut short let go */
    ids(): string[] {
      if (!dir) return [...held.keys()];
      return readdirSync(dir).flatMap((name) => {
        if (name.endsWith(".json")) return [name.slice(0, -5)];
        rmSync(join(dir, name), { force: true });
        return [];
      });
    },
  };
}

export function createPusher(opts: {
  publicKey: string;
  privateKey: string;
  subject: string;
  store?: string;
  send?: Send;
}): Pusher {
  const slots = new Map<string, Slot>();
  const entries = entryShelf(opts.store ? `${opts.store}.d` : null);
  /**
   * When each subscription let go for having nothing left to send was last sent to (A83), kept for the gap between
   * reminders, so planning again soon after does not bring the next one early; oldest first, gone once past the gap
   */
  const lastSentOf = new Map<string, number>();
  const rememberSent = (id: string, at: number, now: number) => {
    for (const [k, t] of lastSentOf) {
      if (now - t < MIN_GAP_MS && lastSentOf.size < MAX_SUBS) break;
      lastSentOf.delete(k);
    }
    lastSentOf.delete(id);
    if (now - at < MIN_GAP_MS) lastSentOf.set(id, at);
  };
  const ownerOf = (e: { by?: string; net?: string }) =>
    e.by !== undefined ? { by: e.by, ...(e.net !== undefined ? { net: e.net } : {}) } : {};
  const keep = (id: string, e: Entry) => {
    entries.put(id, e);
    const first = e.reminders[0];
    if (first) slots.set(id, { next: first.at, lastSent: e.lastSent, ...ownerOf(e) });
  };
  if (opts.store && hasStore(opts.store)) {
    // a store kept as one file before P10 is moved into a file each, once; a file written since is newer and kept
    try {
      for (const e of readStore(opts.store) as Entry[]) {
        if (!isPushEndpoint(e.sub.endpoint) || entries.has(idOf(e.sub.endpoint))) continue;
        // a plan kept before addresses were coded held its planner's address: it is coded now (P6a)
        const c = e.by === undefined || CODE.test(e.by) ? null : recoded(e.by);
        entries.put(idOf(e.sub.endpoint), c ? { ...e, by: c.by, ...(c.net !== undefined ? { net: c.net } : {}) } : e);
      }
    } catch (e) {
      // a damaged file starts empty rather than stopping the server (readStore kept it aside and said so)
      process.stderr.write(`${opts.store}: reminders not moved: ${(e as Error).message}\n`);
    }
    for (const f of [opts.store, `${opts.store}.bak`, `${opts.store}.tmp`]) rmSync(f, { force: true });
  }
  for (const id of entries.ids()) {
    const e = entries.get(id);
    if (e && isPushEndpoint(e.sub.endpoint) && idOf(e.sub.endpoint) === id && e.reminders.length) keep(id, e);
    else entries.remove(id);
  }
  if (opts.store) scrubAsides(dirname(opts.store), basename(opts.store));
  const send: Send =
    opts.send ??
    (async (sub, payload) => {
      try {
        await webpush.sendNotification(sub, payload, {
          vapidDetails: { subject: opts.subject, publicKey: opts.publicKey, privateKey: opts.privateKey },
          TTL: 6 * 3600,
          urgency: "normal",
        });
        return { gone: false };
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return { gone: code === 404 || code === 410 };
      }
    });
  const drop = (id: string) => {
    slots.delete(id);
    entries.remove(id);
  };

  return {
    publicKey: opts.publicKey,
    size: () => slots.size,
    plan: (p, now, from) => {
      const endpoint = p.subscription.endpoint;
      if (!isPushEndpoint(endpoint)) return { ok: false, reason: "badEndpoint" };
      const id = idOf(endpoint);
      const prev = slots.get(id);
      if (!prev && slots.size >= MAX_SUBS) return { ok: false, reason: "full" };
      const who = from !== undefined ? codeOf(from) : undefined;
      if (!prev && who && heldOverCoded([...slots.values()].flatMap(plannerOf), who, MAX_DEVICES_PER_ADDRESS))
        return { ok: false, reason: "tooMany" };
      const reminders = p.reminders
        .filter((r) => r.at >= now - 60_000 && r.at <= now + HORIZON_MS)
        .map((r) => ({ kind: r.kind, at: outOfQuietHours(Math.max(r.at, now), p.tz) }))
        .sort((a, b) => a.at - b.at);
      const lastSent = prev?.lastSent ?? lastSentOf.get(id) ?? 0;
      // a plan with nothing to send holds no place (A83)
      if (reminders.length === 0) {
        if (prev) drop(id);
        rememberSent(id, lastSent, now);
        return { ok: true };
      }
      try {
        keep(id, {
          sub: p.subscription,
          lang: p.lang,
          name: p.name,
          tz: p.tz,
          reminders,
          lastSent,
          ...ownerOf(who ?? prev ?? {}),
        });
      } catch (e) {
        // a plan that could not be written is not kept, and the player is told it was not
        process.stderr.write(`reminder plan not kept: ${(e as Error).message}\n`);
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true };
    },
    stop: (endpoint) => {
      const id = idOf(endpoint);
      const had = slots.has(id);
      if (had) drop(id);
      return had;
    },
    tick: async (now) => {
      let sent = 0;
      const due = [...slots].filter(([, s]) => s.next <= now).map(([id]) => id);
      for (const id of due) {
        const slot = slots.get(id);
        // stopped, or planned again for later, while an earlier one was being sent
        if (!slot || slot.next > now) continue;
        const e = entries.get(id);
        if (!e) {
          // its file gone or cut short: nothing to send from (entries.get said so)
          drop(id);
          continue;
        }
        const reached = e.reminders.filter((r) => r.at <= now);
        const left = e.reminders.filter((r) => r.at > now);
        const sending = reached.length > 0 && now - slot.lastSent >= MIN_GAP_MS;
        const lastSent = sending ? now : slot.lastSent;
        // what is left is kept before the send, so a plan made while it is on its way is never written over
        if (left.length) {
          try {
            keep(id, { ...e, reminders: left, lastSent });
          } catch (err) {
            process.stderr.write(`reminder ${id} not updated: ${(err as Error).message}\n`);
          }
        } else {
          // what has nothing left to send lets its place go, its last reminder's time kept for the gap (A83)
          drop(id);
          rememberSent(id, lastSent, now);
        }
        if (!sending) continue;
        // the most pressing need among those due: sickness, then hunger, then the rest
        const order: ReminderKind[] = ["sick", "hungry", "dirty", "bored"];
        const kind = order.find((k) => reached.some((d) => d.kind === k)) ?? "hungry";
        const text = reminderText(kind, e.lang, e.name);
        const r = await send(e.sub, JSON.stringify({ ...text, kind, url: "play.html" }));
        if (r.gone) {
          drop(id);
          lastSentOf.delete(id);
          continue;
        }
        sent++;
      }
      return sent;
    },
  };
}
