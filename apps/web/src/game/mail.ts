/**
 * In-game mail (PRD S7): letters to everyone from the server, and personal
 * letters the game writes (a season result, a keepsake on its way). What has
 * been read and which gifts were taken are kept on this device.
 */

import { create } from "zustand";
import { useWorld } from "./world";
import { saveWrite } from "./saveRuntime";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const KEY = "lingxi.mail.v1";

export interface Letter {
  id: string;
  at: number;
  subject: { en: string; zh: string };
  body: { en: string; zh: string };
  gift?: { item: number; n: number };
  /** a letter every newcomer should find unread, however long ago it was sent (the welcome) */
  greets?: boolean;
  /** written by the game on this device */
  local?: boolean;
}

interface Kept {
  read: string[];
  claimed: string[];
  local: Letter[];
  /**
   * When this mailbox was first opened (G8): letters sent before it stay readable, gifts and all, but only one that
   * greets a newcomer counts as unread. A mailbox from before this was kept has none, and counts every letter.
   */
  since?: number;
}

function load(): Kept {
  try {
    const raw = localStorage.getItem(KEY);
    // a mailbox opened for the first time starts now; one kept from before keeps what it had
    const k = raw ? (JSON.parse(raw) as Partial<Kept>) : { since: Date.now() };
    return { read: k.read ?? [], claimed: k.claimed ?? [], local: k.local ?? [], ...(typeof k.since === "number" ? { since: k.since } : {}) };
  } catch {
    return { read: [], claimed: [], local: [] };
  }
}

function hasKept(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
}

function save(k: Kept) {
  try {
    saveWrite(KEY, JSON.stringify(k));
  } catch {
    // private mode: lasts for this visit
  }
}

interface MailStore extends Kept {
  letters: Letter[];
  loaded: boolean;
  fetch: () => Promise<void>;
  open: (id: string) => void;
  claim: (id: string) => void;
  /** a personal letter from the game; the same id is never written twice */
  write: (letter: Omit<Letter, "local">) => void;
}

export const useMail = create<MailStore>((set, get) => {
  const keep = (patch: Partial<Kept>) => {
    const since = get().since;
    const next = { read: get().read, claimed: get().claimed, local: get().local, ...(since !== undefined ? { since } : {}), ...patch };
    save(next);
    set(next);
  };
  return {
    ...load(),
    letters: [],
    loaded: false,
    fetch: async () => {
      // a newcomer's arrival is kept the first time the mailbox loads, so a later visit does not move it
      if (get().since !== undefined && !hasKept()) keep({});
      // the on-chain (DeWEB) build has no server: only the letters the game writes itself
      if (!BASE) return set({ loaded: true });
      try {
        const r = await fetch(`${BASE}/api/mail`);
        const j = (await r.json()) as { ok: boolean; letters: Letter[] };
        set({ letters: j.ok ? j.letters : [], loaded: true });
      } catch {
        set({ loaded: true });
      }
    },
    open: (id) => {
      if (!get().read.includes(id)) keep({ read: [...get().read, id] });
    },
    claim: (id) => {
      const l = [...get().letters, ...get().local].find((x) => x.id === id);
      if (!l?.gift || get().claimed.includes(id)) return;
      useWorld.getState().receive(l.gift.item, l.gift.n);
      keep({ claimed: [...get().claimed, id] });
    },
    write: (letter) => {
      if (get().local.some((l) => l.id === letter.id)) return;
      keep({ local: [{ ...letter, local: true }, ...get().local].slice(0, 50) });
    },
  };
});

/** Everything in the mailbox, newest first. */
export const allLetters = (s: Pick<MailStore, "letters" | "local">): Letter[] => [...s.local, ...s.letters].sort((a, b) => b.at - a.at);
/** Letters waiting to be read: not opened yet, and sent since the mailbox was first opened or greeting a newcomer (G8). */
export const isUnread = (s: Pick<MailStore, "read" | "since">, l: Letter): boolean => !s.read.includes(l.id) && (s.since === undefined || l.at >= s.since || l.greets === true);
export const unreadCount = (s: Pick<MailStore, "letters" | "local" | "read" | "since">): number => allLetters(s).filter((l) => isUnread(s, l)).length;
