/**
 * Every write of the game's own state goes through here, so a save is never lost to the ways it used to be:
 *
 * - only the tab that holds the writer lock (writer.ts) may write the game's state; any other tab is refused, so two
 *   open tabs can no longer write over each other (the QA run lost a gift exactly that way);
 * - before a value is replaced, the one it replaces is kept as `<key>~copy` (on the first change of a visit, then at
 *   most every few minutes), and only a copy that parses is ever kept, so there is always a good one to go back to;
 * - a save that will not parse is kept aside as it was (`<key>~damaged`), reported, and never written over until the
 *   player chooses what to do with it;
 * - a full or blocked storage is reported instead of being swallowed, and storage use is watched before it fills.
 *
 * Preferences (language, sound, which RPC the proof page asks) are not game state: any tab may change them.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** Why a save is held: it will not parse, or it parses but this build cannot read it (most likely a newer Lingxi's). */
export type Damage = "unreadable" | "newer";
export interface Held {
  key: string;
  why: Damage;
}
/** What this build expects under a key: "ok", or why it cannot read what it found. */
export type SaveReader = (value: unknown) => "ok" | Damage;

export type SaveEvent =
  | { kind: "refused"; key: string }
  | { kind: "failed"; key: string; reason: "full" | "blocked" }
  | { kind: "damaged"; key: string; why: Damage }
  | { kind: "nearlyFull"; usedChars: number; warnAtChars: number };

/** A replaced value is copied at most this often (and always on the first change of a visit). */
export const COPY_EVERY_MS = 5 * 60_000;
const COPY = "~copy";
const DAMAGED = "~damaged";
/** Browsers give a site about five million characters of storage; warn well before. */
const WARN_AT_CHARS = 3_500_000;
/** Storage use is measured again after this many writes. */
const MEASURE_EVERY = 50;

/** Kept by any tab: they change how the game looks, not what the player has (and the writers' own stamps). */
const PREFERENCES = new Set(["lingxi.lang", "lingxi.sound", "lingxi.reveal.v1", "lingxi.proof.rpc", "lingxi.proof.taken.v1", "lingxi.proof.checked.v1", "lingxi.example", "lingxi.writer.lease", "lingxi.handheld.lease"]);
/**
 * Mailboxes between the game and the browser handheld (handheldKeys.ts): one page leaves a packet, the other takes it,
 * by design from two tabs at once. The handheld page keeps itself to one tab with its own lock.
 */
const MAILBOXES = new Set(["lingxi.handheld.inbox.v1", "lingxi.handheld.return.v1", "lingxi.handheld.device.v1"]);

/** The game's own state (keys included): written only by the writer, copied, checked. */
export const isGameKey = (key: string): boolean => key.startsWith("lingxi.") && !PREFERENCES.has(key) && !MAILBOXES.has(key) && !key.endsWith(COPY) && !key.endsWith(DAMAGED);

/** Text that is meant to be JSON: an object or a list. Plain values (an id, a key) are not checked as JSON. */
const looksJson = (raw: string) => /^\s*[[{]/.test(raw);
const parses = (raw: string): boolean => {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
};

export interface SaveOptions {
  storage: KeyValueStore;
  now: () => number;
  isWriter: () => boolean;
  onEvent: (e: SaveEvent) => void;
  warnAtChars?: number;
}

export function createSaveStore(o: SaveOptions) {
  const warnAt = o.warnAtChars ?? WARN_AT_CHARS;
  /** keys whose damaged save waits for the player's choice: nothing writes over them meanwhile */
  const held = new Map<string, Damage>();
  /** when each key's copy was last taken this visit */
  const copiedAt = new Map<string, number>();
  let writes = 0;

  const usedChars = () => {
    let n = 0;
    for (let i = 0; i < o.storage.length; i++) {
      const k = o.storage.key(i);
      if (k) n += k.length + (o.storage.getItem(k)?.length ?? 0);
    }
    return n;
  };
  const measure = () => {
    const used = usedChars();
    if (used >= warnAt) o.onEvent({ kind: "nearlyFull", usedChars: used, warnAtChars: warnAt });
  };

  const failure = (key: string, e: unknown) => {
    const name = e instanceof Error || e instanceof DOMException ? e.name : "";
    o.onEvent({ kind: "failed", key, reason: /Quota/i.test(name) ? "full" : "blocked" });
  };

  /** Keeps the value about to be replaced, when it is good and the last copy is old enough. */
  const keepCopy = (key: string, old: string | null) => {
    if (old === null || (looksJson(old) && !parses(old))) return;
    const at = copiedAt.get(key);
    if (at !== undefined && o.now() - at < COPY_EVERY_MS) return;
    try {
      o.storage.setItem(key + COPY, old);
      copiedAt.set(key, o.now());
    } catch {
      // no room for the copy: the write itself will say whether there is room for the save
    }
  };

  const allowed = (key: string): boolean => {
    if (!isGameKey(key)) return true;
    if (!o.isWriter()) {
      o.onEvent({ kind: "refused", key });
      return false;
    }
    return !held.has(key);
  };

  return {
    /** Writes `value` under `key`; false when it was refused or failed (and the reason was reported). */
    write(key: string, value: string): boolean {
      if (!allowed(key)) return false;
      const old = o.storage.getItem(key);
      if (old === value) return true;
      if (isGameKey(key)) keepCopy(key, old);
      try {
        o.storage.setItem(key, value);
      } catch (e) {
        failure(key, e);
        return false;
      }
      if (++writes % MEASURE_EVERY === 1) measure();
      return true;
    },

    remove(key: string): boolean {
      if (!allowed(key)) return false;
      if (isGameKey(key)) keepCopy(key, o.storage.getItem(key));
      try {
        o.storage.removeItem(key);
        return true;
      } catch (e) {
        failure(key, e);
        return false;
      }
    },

    read: (key: string): string | null => o.storage.getItem(key),

    /**
     * Keeps a save this build cannot use aside (`<key>~damaged`, the latest such save), reports it, and refuses writes
     * over it until the player chooses. The save itself also stays where it is.
     */
    hold(key: string, raw: string, why: Damage) {
      if (held.has(key)) return;
      try {
        o.storage.setItem(key + DAMAGED, raw);
      } catch {
        // no room to set it aside: it stays where it is, and nothing writes over it
      }
      held.set(key, why);
      o.onEvent({ kind: "damaged", key, why });
    },

    /**
     * Every game save this build cannot use, each now held and reported: one meant to be JSON that does not parse, and
     * one that parses but fails the reader this build has for its key (a newer version, or a shape it cannot read).
     * Runs at start, before anything reads the game's state.
     */
    check(readers: Readonly<Record<string, SaveReader>> = {}): Held[] {
      const bad: Held[] = [];
      for (let i = 0; i < o.storage.length; i++) {
        const k = o.storage.key(i);
        if (!k || !isGameKey(k)) continue;
        const raw = o.storage.getItem(k);
        if (raw === null) continue;
        let why: Damage | null = null;
        if (looksJson(raw)) {
          try {
            const value: unknown = JSON.parse(raw);
            const reader = readers[k];
            const verdict = reader ? reader(value) : "ok";
            why = verdict === "ok" ? null : verdict;
          } catch {
            why = "unreadable";
          }
        } else if (readers[k]) why = "unreadable";
        if (why) bad.push({ key: k, why });
      }
      for (const b of bad) this.hold(b.key, o.storage.getItem(b.key) ?? "", b.why);
      return bad;
    },

    held: (): Held[] => [...held].map(([key, why]) => ({ key, why })),

    /** The player chose the last good copy: it is put back, and the damaged save stays aside to be downloaded. */
    useCopy(key: string): boolean {
      const copy = o.storage.getItem(key + COPY);
      if (copy === null || !o.isWriter()) return false;
      try {
        o.storage.setItem(key, copy);
      } catch (e) {
        failure(key, e);
        return false;
      }
      held.delete(key);
      return true;
    },

    /** The player chose to start this part afresh: the damaged save stays aside to be downloaded. */
    startFresh(key: string): boolean {
      if (!o.isWriter()) return false;
      o.storage.removeItem(key);
      held.delete(key);
      return true;
    },

    usedChars,
  };
}
export type SaveStore = ReturnType<typeof createSaveStore>;
