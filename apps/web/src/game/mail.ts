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
  /** when it stops being current (the server leaves it out after this) */
  until?: number;
  /** about something only the web version's server offers (seasons): left out of the on-chain copy (H11) */
  needsServer?: boolean;
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
      // the on-chain (DeWEB) build has no server: it reads the letters shipped beside the page (H11)
      try {
        const r = await fetch(mailUrl(BASE));
        set({ letters: lettersFrom(await r.json(), Date.now(), BASE !== ""), loaded: true });
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

/** Where the letters to everyone come from: the server, or in the on-chain copy the file shipped beside the page. */
export const mailUrl = (base: string): string => (base ? `${base}/api/mail` : "./mail.json");

const isText = (t: unknown): t is { en: string; zh: string } => !!t && typeof (t as { en?: unknown }).en === "string" && typeof (t as { zh?: unknown }).zh === "string";
const isLetter = (l: unknown): l is Letter => {
  const x = l as Partial<Letter> | null;
  return !!x && typeof x.id === "string" && /^[a-z0-9-]{1,40}$/.test(x.id) && typeof x.at === "number" && isText(x.subject) && isText(x.body) && (x.gift === undefined || (typeof x.gift.item === "number" && typeof x.gift.n === "number" && x.gift.n >= 1 && x.gift.n <= 20));
};

/**
 * The letters to everyone, from what was read: the server's answer is taken as it is (the server already keeps only the
 * current ones); the on-chain copy's file holds every letter, so only well-formed ones current now are kept, and none
 * about what only the web version's server offers (H11). Newest first.
 */
export function lettersFrom(body: unknown, now: number, fromServer: boolean): Letter[] {
  if (fromServer) {
    const j = body as { ok?: boolean; letters?: unknown } | null;
    return j?.ok && Array.isArray(j.letters) ? j.letters.filter(isLetter) : [];
  }
  if (!Array.isArray(body)) return [];
  return body.filter(isLetter).filter((l) => l.at <= now && (!l.until || l.until > now) && !l.needsServer).sort((a, b) => b.at - a.at);
}

/** Everything in the mailbox, newest first. */
export const allLetters = (s: Pick<MailStore, "letters" | "local">): Letter[] => [...s.local, ...s.letters].sort((a, b) => b.at - a.at);
/** Letters waiting to be read: not opened yet, and sent since the mailbox was first opened or greeting a newcomer (G8). */
export const isUnread = (s: Pick<MailStore, "read" | "since">, l: Letter): boolean => !s.read.includes(l.id) && (s.since === undefined || l.at >= s.since || l.greets === true);
export const unreadCount = (s: Pick<MailStore, "letters" | "local" | "read" | "since">): number => allLetters(s).filter((l) => isUnread(s, l)).length;
