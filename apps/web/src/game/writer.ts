/**
 * One tab writes the game; any other shows "Lingxi is open in another tab" until the player moves the game to it.
 *
 * The writer holds a Web Lock for the life of its page (the browser releases it if the tab closes or crashes), and
 * stamps its id in storage the moment it takes over. A tab is the writer only while it holds the lock and the stamp
 * is its own, checked on every write, so a tab whose game was just taken over stops before its next write, even
 * before the browser has told it the lock is gone. Where the Web Locks API is missing (older engines, some in-app
 * browsers), the stamp becomes a lease renewed every few seconds, and a tab closed without a word gives its place up
 * when its lease runs out.
 */

export const LOCK_NAME = "lingxi-writer";
export const STAMP_KEY = "lingxi.writer.lease";
/** Without Web Locks: how long a writer's lease lasts, and how often the writer renews it. */
export const LEASE_MS = 6_000;
export const RENEW_MS = 2_000;
/**
 * Without Web Locks: how long a tab watches a lease that is not its own for the renewal a live tab makes every
 * RENEW_MS. Not renewed in that time, the page that held it is gone (a crash, a tab the system killed) and its lease is
 * taken over, so a player is never kept out by a page that no longer exists (A8).
 */
export const WATCH_MS = 3_000;

export interface LockApi {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: unknown | null) => unknown): Promise<unknown>;
}

interface Stamp {
  id: string;
  until: number;
  /**
   * Raised each time a tab takes the game (A97): another tab's write reaches this one a moment late, so a tab renewing
   * from a stale view could write over the stamp of the tab that just took over. The newest generation wins. A stamp
   * written by a page from before generations has none, and is respected as a claim.
   */
  gen?: number;
}

export interface WriterOptions {
  /** the lock and its stamp: the game's by default; the browser handheld keeps its own */
  lockName?: string;
  stampKey?: string;
  /** `navigator.locks` where the browser has it */
  locks?: LockApi;
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  now: () => number;
  onChange?: (writer: boolean) => void;
  /** runs `fn` every `ms`; returns a stop function (setInterval in the browser) */
  every?: (fn: () => void, ms: number) => () => void;
  /** lets `ms` pass (setTimeout in the browser) */
  wait?: (ms: number) => Promise<void>;
  /**
   * Without Web Locks: tells `fn` the key another page of this site just wrote and its new value (the browser's storage
   * event; the value is the one written, where this page's storage may still lag behind it), so a
   * tab whose game was taken says so at once rather than on its next renewal, which a hidden page runs late (A70).
   * Returns a stop function.
   */
  watch?: (fn: (key: string, value?: string | null) => void) => () => void;
  id?: string;
}

/** The browser's storage event, as `WriterOptions.watch` takes it: the key another page of this site just wrote (A70). */
export const browserStorageWatch: WriterOptions["watch"] =
  typeof window === "undefined"
    ? undefined
    : (fn) => {
        const on = (e: StorageEvent) => e.key !== null && fn(e.key, e.newValue);
        window.addEventListener("storage", on);
        return () => window.removeEventListener("storage", on);
      };

export function createWriter(o: WriterOptions) {
  const id = o.id ?? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const every = o.every ?? ((fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  });
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lockName = o.lockName ?? LOCK_NAME;
  const stampKey = o.stampKey ?? STAMP_KEY;
  let held = false;
  // without Web Locks: this page gave its lease up as it went (A8), and may take it back if the browser restores it
  let gaveUp = false;
  let stopRenewing: (() => void) | null = null;
  let stopWatching: (() => void) | null = null;
  /** the generation of this tab's claim (A97) */
  let gen = 0;

  const parseStamp = (raw: string | null): Stamp | null => {
    try {
      const s = JSON.parse(raw ?? "null") as Stamp | null;
      if (!s || typeof s.id !== "string" || typeof s.until !== "number") return null;
      const { gen: g, ...rest } = s;
      return Number.isInteger(g) ? { ...rest, gen: g } : rest;
    } catch {
      return null;
    }
  };
  const readStamp = (): Stamp | null => parseStamp(o.storage.getItem(stampKey));
  /** false when storage cannot be written at all: then this tab is the only writer it can be */
  const writeStamp = (): boolean => {
    try {
      o.storage.setItem(stampKey, JSON.stringify({ id, until: o.now() + LEASE_MS, gen }));
      return true;
    } catch {
      return false;
    }
  };
  /**
   * a claim newer than this tab's, from another tab: the game is theirs. A claim without a generation comes from a
   * page of the build before generations, which knows no other way to say it took the game: it is respected.
   */
  const newer = (s: Stamp | null) => s !== null && s.id !== id && (s.gen === undefined || s.gen >= gen);
  const set = (w: boolean) => {
    if (held === w) return;
    held = w;
    if (!w) {
      stopRenewing?.();
      stopRenewing = null;
      stopWatching?.();
      stopWatching = null;
    }
    o.onChange?.(w);
  };

  const viaLocks = (locks: LockApi, steal: boolean) =>
    new Promise<boolean>((decided) => {
      locks
        .request(lockName, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            decided(false);
            return undefined;
          }
          gen = (readStamp()?.gen ?? 0) + 1;
          writeStamp();
          set(true);
          decided(true);
          // held for the life of the page
          return new Promise(() => undefined);
        })
        .catch(() => {
          // taken over by another tab (or the browser aborted the request)
          set(false);
          decided(false);
        });
    });

  const viaLease = async (steal: boolean): Promise<boolean> => {
    const stamp = readStamp();
    if (!steal && stamp && stamp.id !== id && stamp.until > o.now()) {
      // a live tab renews its lease; one that has not, within the watch, belonged to a page that is gone
      await wait(WATCH_MS);
      const now = readStamp();
      const renewed = now !== null && now.id !== id && now.until > o.now() && (now.id !== stamp.id || now.until !== stamp.until);
      if (renewed) return false;
    }
    // taking the game: a generation past the newest this tab has seen (A97)
    gen = Math.max(gen, readStamp()?.gen ?? 0) + 1;
    if (!writeStamp()) {
      set(true);
      return true;
    }
    set(true);
    stopRenewing = every(() => {
      // a newer claim is another tab's game; an older one over this tab's (written from a stale view) is overwritten
      if (newer(readStamp())) set(false);
      else writeStamp();
    }, RENEW_MS);
    // another page wrote the stamp: read what it wrote, not this page's storage, which may still lag (A70, A97)
    stopWatching?.();
    stopWatching =
      o.watch?.((key, value) => {
        if (key !== stampKey) return;
        const s = value === undefined ? readStamp() : parseStamp(value);
        if (newer(s)) set(false);
        else if (s && s.id !== id) writeStamp();
      }) ?? null;
    return true;
  };

  return {
    id,
    /** Tries to become the writer; with `steal`, takes the game over from whichever tab has it. */
    acquire: async ({ steal = false }: { steal?: boolean } = {}): Promise<boolean> => (o.locks ? viaLocks(o.locks, steal) : viaLease(steal)),
    /**
     * Without Web Locks, the page is going (`pagehide`: a reload, a link, a closed tab, the back-forward cache): it
     * gives its lease up at once, so the next page plays without waiting for the lease to run out. A Web Lock is
     * released by the browser itself.
     */
    leave(): void {
      if (o.locks || !held) return;
      stopRenewing?.();
      stopRenewing = null;
      const s = readStamp();
      try {
        if (s && s.id === id) o.storage.removeItem(stampKey);
      } catch {
        // storage gone: the lease runs out on its own
      }
      // still the writer for this page's last words (a later `pagehide` handler may save), until another page stamps
      gaveUp = true;
    },
    /** Without Web Locks, a page restored from the back-forward cache takes its lease back, unless a tab has the game. */
    rejoin: async (): Promise<boolean> => {
      if (o.locks) return held;
      if (!gaveUp) return false;
      gaveUp = false;
      const back = await viaLease(false);
      if (!back) set(false);
      return back;
    },
    /**
     * True only while this tab holds the game and no newer claim is in storage (checked on every write). An older
     * claim over this tab's, from a tab renewing on a stale view, does not take the game: this tab writes over it.
     */
    isWriter(): boolean {
      if (!held) return false;
      return !newer(readStamp());
    },
  };
}
export type Writer = ReturnType<typeof createWriter>;

/** The part of the Web Locks API that reports which locks are held. */
export interface LockQuery {
  query(): Promise<{ held?: Array<{ name?: string }> }>;
}

/**
 * Whether some tab holds the game (or another lock) right now, read without taking anything (A7): from the browser's
 * own record of held Web Locks where it has them, else from a lease stamp still fresh. A writer with Web Locks stamps
 * once and never renews, so its stamp is read only when the browser cannot say.
 */
export async function heldElsewhere(o: { lockName?: string; stampKey?: string; locks?: LockQuery; storage: { getItem(k: string): string | null }; now: () => number }): Promise<boolean> {
  const lockName = o.lockName ?? LOCK_NAME;
  if (o.locks) {
    try {
      return ((await o.locks.query()).held ?? []).some((l) => l.name === lockName);
    } catch {
      // the browser would not say: the stamp is all there is
    }
  }
  try {
    const s = JSON.parse(o.storage.getItem(o.stampKey ?? STAMP_KEY) ?? "null") as Stamp | null;
    return !!s && typeof s.until === "number" && s.until > o.now();
  } catch {
    return false;
  }
}
