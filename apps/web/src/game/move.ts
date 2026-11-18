/**
 * Moving pets between Telegram and a browser (PRD S11). Each place keeps its own
 * storage and only a browser has a wallet, so the player moves their pets: this
 * side hands its save to the server for a one-time code (15 minutes, works once),
 * and the other side opens with the code and takes the save before the game reads
 * it. Keys bound to this device stay behind: the auto-save key (it holds gas), the
 * device id and the reminder subscription. The save that was there before is kept
 * so a move can be undone.
 *
 * The code is fetched before the player taps "open": Telegram only opens links
 * straight from a tap, not after an awaited request (see 29-TELEGRAM-MINI-APP-STUDY).
 */

import { create } from "zustand";
import { inTelegram, openInBrowser, telegramStart } from "./telegram";
import { saveRemove, saveWrite } from "./saveRuntime";
import { SEND_LIMITS, checkSize } from "./sendSize";
import { now as gameNow } from "./gameClock";
import { moveBody } from "./requests";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
/** The Telegram bot that hosts the Mini App, once it exists (for moving pets into Telegram). */
export const TG_BOT = ((import.meta.env.VITE_TG_BOT as string | undefined) ?? "LingxiPetBot").replace(/^@/, "");
const STAY = new Set(["lingxi.session.v1", "lingxi.device.v1", "lingxi.reminders.v1"]);
const BEFORE = "lingxi.before-move.v1";
const MOVED = "lingxi.moved.v1";
const ARRIVED = "lingxi.arrived";
/** Never part of a save that travels: a tab's stamps, and the copies the save module keeps (save.ts). */
const NEVER = new Set(["lingxi.writer.lease", "lingxi.handheld.lease"]);
/** Keys that act for this device or player: one replaced by a different one is kept for good under REPLACED. */
const DEVICE_KEYS = ["lingxi.session.v1", "lingxi.device.v1", "lingxi.player.v1", "lingxi.decorKey"] as const;
const REPLACED = "lingxi.keys.replaced.v1";
type Arrival = "ok" | "restored" | "gone" | "failed";
const CODE = /^[A-Za-z0-9_-]{22}$/;

export type MoveTo = "browser" | "telegram";
export const moveAvailable = (to: MoveTo): boolean => !!BASE && (to === "browser" ? inTelegram() : !!TG_BOT && !inTelegram());

/** This device's save; with `keys`, the keys that stay with the device too (a save file carries them). */
function snapshot(keys = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("lingxi.") || (!keys && STAY.has(k)) || k === BEFORE || k === MOVED || NEVER.has(k) || k.endsWith("~copy") || k.endsWith("~damaged")) continue;
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

/** Step 1: hand this device's pets to the server; returns the one-time code. A save too large to move throws TooBig, unsent. */
export async function prepareMove(): Promise<string> {
  const save = snapshot();
  const body = JSON.stringify(moveBody(save));
  const chars = Object.entries(save).reduce((n, [k, v]) => n + k.length + v.length, 0);
  checkSize(body, SEND_LIMITS.moveBodyBytes, { unit: "bytes", have: chars, most: SEND_LIMITS.moveChars });
  const r = await fetch(`${BASE}/api/move`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(20000) });
  const j = (await r.json()) as { ok: boolean; code?: string; reason?: string };
  if (!j.ok || !j.code) throw new Error(j.reason ?? "failed");
  return j.code;
}

export function moveLink(to: MoveTo, code: string): string {
  // the Mini App's direct link (BotFather short name "Play"); Telegram passes startapp to the app as its start parameter
  if (to === "telegram") return `https://t.me/${TG_BOT}/Play?startapp=move_${code}`;
  const u = new URL("play.html", location.href);
  u.search = `?move=${code}`;
  u.hash = "";
  return u.href;
}

/** Step 2, run straight from the tap: open the other side and note that the pets left. */
export function openMove(to: MoveTo, code: string): void {
  const link = moveLink(to, code);
  if (to === "browser") {
    if (!openInBrowser(link)) location.href = link;
  } else window.open(link, "_blank", "noopener");
  const moved = { to, at: gameNow() };
  try {
    saveWrite(MOVED, JSON.stringify(moved));
  } catch {
    // the move still happened; only the note here is lost
  }
  useMove.setState({ moved, ask: false });
}

/**
 * The code this page was opened with: from a browser link (removed from the address once read, so a reload
 * never repeats it) or a Telegram start parameter (which Telegram keeps on every reload of the session).
 */
function arrivingCode(): { code: string; sticky: boolean } | null {
  const q = new URLSearchParams(location.search).get("move");
  if (q && CODE.test(q)) return { code: q, sticky: false };
  const s = telegramStart();
  if (s?.startsWith("move_") && CODE.test(s.slice(5))) return { code: s.slice(5), sticky: true };
  return null;
}

/** Whether a save holds any pets (an empty one is not worth keeping as a backup). */
function hasPets(save: Record<string, string>): boolean {
  try {
    const r = JSON.parse(save["lingxi.pets.v2"] ?? "null") as { pets?: unknown[] } | null;
    return (Array.isArray(r?.pets) && r.pets.length > 0) || !!save["lingxi.pet.v1"];
  } catch {
    return false;
  }
}

function note(v: Arrival): void {
  try {
    sessionStorage.setItem(ARRIVED, v);
  } catch {
    // the pets still arrived (or didn't); only the message is lost
  }
}

/**
 * Runs before the game loads its save: takes the pets that are arriving, if any.
 * The save that was here is kept under one key so the move can be undone.
 */
export async function receivePets(): Promise<void> {
  await takeArriving();
  // the store was created before the pets arrived: read what happened now
  useMove.setState({ arrived: readArrived(), moved: readMoved(), hasBefore: readBefore() });
}

async function takeArriving(): Promise<void> {
  const arriving = arrivingCode();
  if (!arriving || !BASE) return;
  const { code, sticky } = arriving;
  const url = new URL(location.href);
  if (url.searchParams.has("move")) {
    url.searchParams.delete("move");
    history.replaceState(null, "", url.href);
  }
  if (sticky) {
    try {
      // a reload inside Telegram keeps the start parameter: take each code once, quietly
      if (sessionStorage.getItem(`lingxi.took.${code}`)) return;
      sessionStorage.setItem(`lingxi.took.${code}`, "1");
    } catch {
      // no session storage: the server still hands a code over only once
    }
  }
  let arrived: { ok: boolean; save?: Record<string, string> };
  try {
    arrived = (await (await fetch(`${BASE}/api/move/${code}/claim`, { method: "POST", signal: AbortSignal.timeout(20000) })).json()) as typeof arrived;
  } catch {
    return note("failed");
  }
  if (!arrived.ok || !arrived.save) return note("gone");
  const save = Object.fromEntries(Object.entries(arrived.save).filter(([k, v]) => k.startsWith("lingxi.") && !STAY.has(k) && typeof v === "string"));
  note(land(save, false) ? "ok" : "failed");
}

/** Keys kept from earlier restores and moves, from this device and from what arrives. */
function readReplaced(raw: string | null | undefined): Array<{ at: number; keys: Record<string, string> }> {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((e): e is { at: number; keys: Record<string, string> } => !!e && typeof e === "object" && typeof (e as { at?: unknown }).at === "number" && !!(e as { keys?: unknown }).keys) : [];
  } catch {
    return [];
  }
}

/** What the device holds after `next` lands without touching the keys that stay with it. */
const withStaying = (now: Record<string, string>, next: Record<string, string>) => ({ ...Object.fromEntries(Object.entries(now).filter(([k]) => STAY.has(k))), ...next });

/** The kept keys after `next` replaces `now`: every device key that would be lost is added, none ever dropped. */
function keptKeys(now: Record<string, string>, next: Record<string, string>): string | null {
  const all = [...readReplaced(now[REPLACED]), ...readReplaced(next[REPLACED])];
  const lost: Record<string, string> = {};
  for (const k of DEVICE_KEYS) if (now[k] && next[k] !== now[k] && !all.some((e) => e.keys[k] === now[k])) lost[k] = now[k]!;
  if (Object.keys(lost).length) all.push({ at: gameNow(), keys: lost });
  const seen = new Set<string>();
  const unique = all.filter((e) => {
    const id = JSON.stringify(e.keys);
    return seen.has(id) ? false : (seen.add(id), true);
  });
  return unique.length ? JSON.stringify(unique) : null;
}

/**
 * Puts `save` in place of this device's save. What was here is kept under BEFORE so it can be undone, and a device
 * key it replaces is kept for good (keptKeys). With `keys`, the device's own keys are replaced too (a save file).
 * Nothing is half-done: if storage refuses a write, what was here is put back and false is returned.
 */
function land(save: Record<string, string>, keys: boolean): boolean {
  const now = snapshot(true);
  const before = keys ? now : snapshot();
  const kept = keptKeys(now, keys ? save : withStaying(now, save));
  if (hasPets(before) || (keys && DEVICE_KEYS.some((k) => before[k]))) {
    if (!saveWrite(BEFORE, JSON.stringify(before))) return false;
  } else saveRemove(BEFORE);
  const put = (entries: Record<string, string>) => {
    for (const k of Object.keys(before)) saveRemove(k);
    let ok = true;
    for (const [k, v] of Object.entries(entries)) if (k !== REPLACED) ok = saveWrite(k, v) && ok;
    if (kept) ok = saveWrite(REPLACED, kept) && ok;
    return ok;
  };
  if (put(save)) {
    saveRemove(MOVED);
    return true;
  }
  put(before);
  return false;
}

/**
 * A save file replaces this browser's game, keys included, and the page reloads to read it. "Undo" brings back what
 * was here, as after a move. False when storage refused it (nothing changed).
 */
export function restoreFrom(save: Record<string, string>): boolean {
  if (!land(save, true)) return false;
  note("restored");
  location.reload();
  return true;
}

/** Puts back the save that was here before the last move or restore arrived. */
export function undoArrival(): void {
  try {
    const raw = localStorage.getItem(BEFORE);
    const before = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    const now = snapshot(true);
    const kept = keptKeys(now, withStaying(now, before));
    for (const k of Object.keys(snapshot())) saveRemove(k);
    for (const [k, v] of Object.entries(before)) if (k !== REPLACED) saveWrite(k, v);
    if (kept) saveWrite(REPLACED, kept);
    saveRemove(BEFORE);
    sessionStorage.removeItem(ARRIVED);
  } finally {
    location.reload();
  }
}

function readMoved(): { to: MoveTo; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(MOVED) ?? "null") as { to: MoveTo; at: number } | null;
    return v && (v.to === "browser" || v.to === "telegram") && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}
function readArrived(): Arrival | null {
  try {
    const v = sessionStorage.getItem(ARRIVED);
    return v === "ok" || v === "restored" || v === "gone" || v === "failed" ? v : null;
  } catch {
    return null;
  }
}
function readBefore(): boolean {
  try {
    return !!localStorage.getItem(BEFORE);
  } catch {
    return false;
  }
}

interface MoveState {
  /** a wallet step was tried inside Telegram: offer to continue in the browser */
  ask: boolean;
  /** these pets were moved away from here */
  moved: { to: MoveTo; at: number } | null;
  /** what happened to pets arriving on this visit */
  arrived: Arrival | null;
  hasBefore: boolean;
  offer: () => void;
  closeOffer: () => void;
  stayHere: () => void;
  dismissArrival: () => void;
}

export const useMove = create<MoveState>((set) => ({
  ask: false,
  moved: readMoved(),
  arrived: readArrived(),
  hasBefore: readBefore(),
  offer: () => set({ ask: true }),
  closeOffer: () => set({ ask: false }),
  stayHere: () => {
    try {
      saveRemove(MOVED);
    } catch {
      // nothing to forget
    }
    set({ moved: null });
  },
  dismissArrival: () => {
    try {
      sessionStorage.removeItem(ARRIVED);
    } catch {
      // nothing to forget
    }
    set({ arrived: null });
  },
}));

/** Called when something needs a wallet: inside Telegram, offers the move instead. */
export function walletNeeded(): boolean {
  if (!inTelegram()) return false;
  useMove.setState({ ask: true });
  return true;
}
