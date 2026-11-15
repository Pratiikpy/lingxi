/**
 * Gentle reminders (web build). With the player's permission the browser makes a
 * push subscription; after each change to the pet, the game works out when it
 * will next be hungry, bored, dirty or ill and sends that short plan to Lingxi's
 * server, which sends one notification at the right time (never at night).
 *
 * Phones: Android browsers support this directly. On iPhone, web push works only
 * once Lingxi is added to the Home Screen, which the panel explains.
 */

import { create } from "zustand";
import { upcomingNeeds, type Pet } from "@lingxi/game";
import { brainOf } from "./store";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const KEY = "lingxi.reminders.v1";

export type Support = "ok" | "needsHomeScreen" | "unsupported" | "noServer";

export function support(): Support {
  if (!BASE) return "noServer";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return ios && !standalone ? "needsHomeScreen" : "unsupported";
  return "ok";
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscription(create: boolean): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing || !create) return existing;
  const { key } = (await (await fetch(`${BASE}/api/push/key`, { signal: AbortSignal.timeout(8000) })).json()) as { key: string };
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) as BufferSource });
}

interface RemindState {
  on: boolean;
  busy: boolean;
  error: "denied" | "failed" | null;
  enable: (pet: Pet, lang: "en" | "zh") => Promise<void>;
  disable: () => Promise<void>;
  /** send a fresh plan for this pet (after care, a lesson, a new day) */
  replan: (pet: Pet, lang: "en" | "zh") => Promise<void>;
}

const readOn = () => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};
const writeOn = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // the choice still holds for this visit
  }
};

/** What was last sent, so an unchanged plan is not sent again (the pet changes every minute). */
let lastSig = "";
let lastSentAt = 0;
const RESEND_MS = 6 * 3_600_000;

/** A plan's identity: each need and its time to the nearest ten minutes ("due" if the pet has it now). */
export function planSignature(needs: Array<{ kind: string; at: number }>, now: number, lang: string, name: string): string {
  return [lang, name, ...needs.map((n) => `${n.kind}@${n.at <= now ? "due" : Math.round(n.at / 1_200_000)}`)].join("|");
}

async function sendPlan(sub: PushSubscription, pet: Pet, lang: "en" | "zh", force = false): Promise<boolean> {
  const now = Date.now();
  const needs = upcomingNeeds(pet, now, brainOf(pet)).slice(0, 6);
  const sig = planSignature(needs, now, lang, pet.name);
  if (!force && sig === lastSig && now - lastSentAt < RESEND_MS) return true;
  // a need the pet already has is reminded a little later, not the instant the player looks away
  const reminders = needs.map((n) => ({ kind: n.kind, at: Math.max(n.at, now + 30 * 60_000) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const r = await fetch(`${BASE}/api/push/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys }, lang, name: pet.name.slice(0, 24), tz: -new Date().getTimezoneOffset(), reminders }),
    signal: AbortSignal.timeout(8000),
  });
  if (r.ok) {
    lastSig = sig;
    lastSentAt = now;
  }
  return r.ok;
}

export const useReminders = create<RemindState>((set, get) => ({
  on: readOn(),
  busy: false,
  error: null,
  enable: async (pet, lang) => {
    set({ busy: true, error: null });
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return set({ busy: false, error: "denied" });
      const sub = await subscription(true);
      if (!sub || !(await sendPlan(sub, pet, lang, true))) throw new Error("plan");
      writeOn(true);
      set({ on: true, busy: false });
    } catch {
      set({ busy: false, error: "failed" });
    }
  },
  disable: async () => {
    set({ busy: true, error: null });
    try {
      const sub = await subscription(false);
      if (sub) {
        await fetch(`${BASE}/api/push/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), signal: AbortSignal.timeout(8000) }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch {
      // turning off locally still stops new plans from this device
    }
    writeOn(false);
    set({ on: false, busy: false });
  },
  replan: async (pet, lang) => {
    if (!get().on || support() !== "ok" || Notification.permission !== "granted") return;
    try {
      const sub = await subscription(false);
      if (sub) await sendPlan(sub, pet, lang);
    } catch {
      // the next change tries again
    }
  },
}));
