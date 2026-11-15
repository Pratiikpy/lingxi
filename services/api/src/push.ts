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

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import webpush from "web-push";
import { z } from "zod";

export type ReminderKind = "hungry" | "bored" | "dirty" | "sick";

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];
const MAX_SUBS = 20_000;
const MAX_REMINDERS = 6;
const HORIZON_MS = 48 * 3_600_000;
const MIN_GAP_MS = 3 * 3_600_000;
const QUIET_FROM = 22;
const QUIET_TO = 8;

export const PlanSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(800),
    keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
  }),
  lang: z.enum(["en", "zh"]),
  name: z.string().min(1).max(24),
  /** minutes east of UTC, as the browser reports it */
  tz: z.number().int().min(-840).max(840),
  reminders: z.array(z.object({ kind: z.enum(["hungry", "bored", "dirty", "sick"]), at: z.number().int() })).max(MAX_REMINDERS),
});
export type Plan = z.infer<typeof PlanSchema>;

interface Entry {
  sub: Plan["subscription"];
  lang: Plan["lang"];
  name: string;
  tz: number;
  reminders: Array<{ kind: ReminderKind; at: number }>;
  lastSent: number;
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
  plan: (p: Plan, now: number) => { ok: true } | { ok: false; reason: string };
  stop: (endpoint: string) => boolean;
  /** send whatever is due; returns how many were sent */
  tick: (now: number) => Promise<number>;
  size: () => number;
}

type Send = (sub: Plan["subscription"], payload: string) => Promise<{ gone: boolean }>;

export function createPusher(opts: { publicKey: string; privateKey: string; subject: string; store?: string; send?: Send }): Pusher {
  const subs = new Map<string, Entry>();
  if (opts.store && existsSync(opts.store)) {
    try {
      for (const e of JSON.parse(readFileSync(opts.store, "utf8")) as Entry[]) if (isPushEndpoint(e.sub.endpoint)) subs.set(e.sub.endpoint, e);
    } catch {
      // a damaged file starts empty rather than stopping the server
    }
  }
  const save = () => {
    if (!opts.store) return;
    const tmp = `${opts.store}.tmp`;
    writeFileSync(tmp, JSON.stringify([...subs.values()]));
    renameSync(tmp, opts.store);
  };
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
    plan: (p, now) => {
      if (!isPushEndpoint(p.subscription.endpoint)) return { ok: false, reason: "badEndpoint" };
      if (!subs.has(p.subscription.endpoint) && subs.size >= MAX_SUBS) return { ok: false, reason: "full" };
      const reminders = p.reminders
        .filter((r) => r.at >= now - 60_000 && r.at <= now + HORIZON_MS)
        .map((r) => ({ kind: r.kind, at: outOfQuietHours(Math.max(r.at, now), p.tz) }))
        .sort((a, b) => a.at - b.at);
      const prev = subs.get(p.subscription.endpoint);
      subs.set(p.subscription.endpoint, { sub: p.subscription, lang: p.lang, name: p.name, tz: p.tz, reminders, lastSent: prev?.lastSent ?? 0 });
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
      if (changed) save();
      return sent;
    },
  };
}
