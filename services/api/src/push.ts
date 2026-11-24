/**
 * Gentle reminders by web push. The game works out when the pet will next need
 * its player (packages/game reminders) and sends this server a short plan; at
 * each time the server sends one notification, never more than one every three
 * hours, and never at night on the player's own clock (it waits until 8:00).
 *
 * Only real push services are contacted (the browser's own endpoint, checked
 * against the known push hosts), so a plan can't make this server call any
 * other address. Subscriptions are kept in one JSON file.
 */

import { basename, dirname } from "node:path";
import { CODE, type Coded, codeOf, heldOverCoded, recoded, scrubAsides } from "./pseudonym";
import webpush from "web-push";
import type { PushPlanBody } from "@lingxi/api-schema";
import { hasStore, readStore, saveJson } from "./durable";

export type ReminderKind = "hungry" | "bored" | "dirty" | "sick";

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];
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

const plannerOf = (e: Entry): Coded[] => (e.by === undefined ? [] : [e.net !== undefined ? { by: e.by, net: e.net } : { by: e.by }]);

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

export function createPusher(opts: { publicKey: string; privateKey: string; subject: string; store?: string; send?: Send }): Pusher {
  const subs = new Map<string, Entry>();
  /**
   * When each subscription let go for having nothing left to send was last sent to (A83), kept for the gap between
   * reminders, so planning again soon after does not bring the next one early; oldest first, gone once past the gap
   */
  const lastSentOf = new Map<string, number>();
  const rememberSent = (endpoint: string, at: number, now: number) => {
    for (const [k, t] of lastSentOf) {
      if (now - t < MIN_GAP_MS && lastSentOf.size < MAX_SUBS) break;
      lastSentOf.delete(k);
    }
    lastSentOf.delete(endpoint);
    if (now - at < MIN_GAP_MS) lastSentOf.set(endpoint, at);
  };
  let raw = false;
  if (opts.store && hasStore(opts.store)) {
    try {
      for (const e of readStore(opts.store) as Entry[]) {
        if (!isPushEndpoint(e.sub.endpoint)) continue;
        // a plan kept before addresses were coded held its planner's address: it is coded now (P6a)
        if (e.by === undefined || CODE.test(e.by)) subs.set(e.sub.endpoint, e);
        else {
          const c = recoded(e.by);
          subs.set(e.sub.endpoint, { ...e, by: c.by, ...(c.net !== undefined ? { net: c.net } : {}) });
          raw = true;
        }
      }
    } catch {
      // a damaged file starts empty rather than stopping the server
    }
  }
  const save = () => {
    if (!opts.store) return;
    saveJson(opts.store, [...subs.values()]);
  };
  if (opts.store && raw) {
    // written twice, so the .bak each write keeps holds no address either
    save();
    save();
  }
  if (opts.store) scrubAsides(dirname(opts.store), basename(opts.store));
  const send: Send =
    opts.send ??
    (async (sub, payload) => {
      try {
        await webpush.sendNotification(sub, payload, { vapidDetails: { subject: opts.subject, publicKey: opts.publicKey, privateKey: opts.privateKey }, TTL: 6 * 3600, urgency: "normal" });
        return { gone: false };
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return { gone: code === 404 || code === 410 };
      }
    });

  return {
    publicKey: opts.publicKey,
    size: () => subs.size,
    plan: (p, now, from) => {
      const endpoint = p.subscription.endpoint;
      if (!isPushEndpoint(endpoint)) return { ok: false, reason: "badEndpoint" };
      const prev = subs.get(endpoint);
      if (!prev && subs.size >= MAX_SUBS) return { ok: false, reason: "full" };
      const who = from !== undefined ? codeOf(from) : undefined;
      if (!prev && who && heldOverCoded([...subs.values()].flatMap(plannerOf), who, MAX_DEVICES_PER_ADDRESS)) return { ok: false, reason: "tooMany" };
      const reminders = p.reminders
        .filter((r) => r.at >= now - 60_000 && r.at <= now + HORIZON_MS)
        .map((r) => ({ kind: r.kind, at: outOfQuietHours(Math.max(r.at, now), p.tz) }))
        .sort((a, b) => a.at - b.at);
      const lastSent = prev?.lastSent ?? lastSentOf.get(endpoint) ?? 0;
      // a plan with nothing to send holds no place (A83)
      if (reminders.length === 0) {
        if (prev) subs.delete(endpoint);
        rememberSent(endpoint, lastSent, now);
      } else subs.set(endpoint, { sub: p.subscription, lang: p.lang, name: p.name, tz: p.tz, reminders, lastSent, ...(who ? { by: who.by, ...(who.net !== undefined ? { net: who.net } : {}) } : prev?.by ? { by: prev.by, ...(prev.net !== undefined ? { net: prev.net } : {}) } : {}) });
      save();
      return { ok: true };
    },
    stop: (endpoint) => {
      const had = subs.delete(endpoint);
      if (had) save();
      return had;
    },
    tick: async (now) => {
      let sent = 0;
      let changed = false;
      for (const [endpoint, e] of subs) {
        const due = e.reminders.filter((r) => r.at <= now);
        if (due.length === 0) continue;
        e.reminders = e.reminders.filter((r) => r.at > now);
        changed = true;
        if (now - e.lastSent < MIN_GAP_MS) continue;
        // the most pressing need among those due: sickness, then hunger, then the rest
        const order: ReminderKind[] = ["sick", "hungry", "dirty", "bored"];
        const kind = order.find((k) => due.some((d) => d.kind === k))!;
        const text = reminderText(kind, e.lang, e.name);
        const r = await send(e.sub, JSON.stringify({ ...text, kind, url: "play.html" }));
        if (r.gone) {
          subs.delete(endpoint);
          continue;
        }
        e.lastSent = now;
        sent++;
      }
      // what has nothing left to send lets its place go, its last reminder's time kept for the gap (A83)
      for (const [endpoint, e] of subs) {
        if (e.reminders.length) continue;
        subs.delete(endpoint);
        rememberSent(endpoint, e.lastSent, now);
        changed = true;
      }
      if (changed) save();
      return sent;
    },
  };
}
