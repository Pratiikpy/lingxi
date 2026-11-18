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
const RENEW_MS = 2_000;

export interface LockApi {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: unknown | null) => unknown): Promise<unknown>;
}

interface Stamp {
  id: string;
  until: number;
}

export interface WriterOptions {
  /** the lock and its stamp: the game's by default; the browser handheld keeps its own */
  lockName?: string;
  stampKey?: string;
  /** `navigator.locks` where the browser has it */
  locks?: LockApi;
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  now: () => number;
  onChange?: (writer: boolean) => void;
  /** runs `fn` every `ms`; returns a stop function (setInterval in the browser) */
  every?: (fn: () => void, ms: number) => () => void;
  id?: string;
}

export function createWriter(o: WriterOptions) {
  const id = o.id ?? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const every = o.every ?? ((fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  });
  const lockName = o.lockName ?? LOCK_NAME;
  const stampKey = o.stampKey ?? STAMP_KEY;
  let held = false;
  let stopRenewing: (() => void) | null = null;

  const readStamp = (): Stamp | null => {
    try {
      const s = JSON.parse(o.storage.getItem(stampKey) ?? "null") as Stamp | null;
      return s && typeof s.id === "string" && typeof s.until === "number" ? s : null;
    } catch {
      return null;
    }
  };
  /** false when storage cannot be written at all: then this tab is the only writer it can be */
  const writeStamp = (): boolean => {
    try {
      o.storage.setItem(stampKey, JSON.stringify({ id, until: o.now() + LEASE_MS }));
      return true;
    } catch {
      return false;
    }
  };
  const set = (w: boolean) => {
    if (held === w) return;
    held = w;
    if (!w) {
      stopRenewing?.();
      stopRenewing = null;
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

  const viaLease = (steal: boolean): boolean => {
    const stamp = readStamp();
    if (!steal && stamp && stamp.id !== id && stamp.until > o.now()) return false;
    if (!writeStamp()) {
      set(true);
      return true;
    }
    set(true);
    stopRenewing = every(() => {
      const s = readStamp();
      if (s && s.id !== id) set(false);
      else writeStamp();
    }, RENEW_MS);
    return true;
  };

  return {
    id,
    /** Tries to become the writer; with `steal`, takes the game over from whichever tab has it. */
    acquire: async ({ steal = false }: { steal?: boolean } = {}): Promise<boolean> => (o.locks ? viaLocks(o.locks, steal) : viaLease(steal)),
    /** True only while this tab holds the game and the stamp in storage is its own (checked on every write). */
    isWriter(): boolean {
      if (!held) return false;
      const s = readStamp();
      return s === null || s.id === id;
    },
  };
}
export type Writer = ReturnType<typeof createWriter>;
