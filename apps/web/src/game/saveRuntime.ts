/**
 * The game's one save module and one writer, as the pages use them (save.ts and writer.ts hold the rules). A page that
 * changes the game (the play page) claims the game at start, before anything is read or written: if another tab has
 * it, the page shows "Lingxi is open in another tab" instead; if a save does not parse, the player chooses what to do
 * with it before the game loads. Every write of game state in the game goes through `saveWrite` and `saveRemove`.
 */

import { create } from "zustand";
import { type Held, type KeyValueStore, type SaveEvent, createSaveStore } from "./save";
import { READERS } from "./saveReaders";

export { READERS };
import { type LockApi, browserStorageWatch, createWriter } from "./writer";

/** The browser's storage, or a stand-in in memory where there is none (tests, a storage the browser blocks). */
function browserStorage(): KeyValueStore {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.getItem("lingxi.lang");
      return localStorage;
    }
  } catch {
    // storage blocked (some private modes): the game runs on, and says nothing was saved
  }
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

export interface SaveState {
  /** whether this tab plays the game: deciding at start, then the writer, or another tab has it */
  role: "deciding" | "writer" | "elsewhere";
  /** game saves this build cannot use, kept aside and waiting for the player's choice */
  damaged: Held[];
  /** the last write that failed, and why */
  failed: { key: string; reason: "full" | "blocked"; at: number } | null;
  /** storage is close to full */
  nearlyFull: boolean;
}

export const useSaveState = create<SaveState>(() => ({ role: "deciding", damaged: [], failed: null, nearlyFull: false }));

const storage = browserStorage();
const onEvent = (e: SaveEvent) => {
  if (e.kind === "failed") useSaveState.setState({ failed: { key: e.key, reason: e.reason, at: Date.now() } });
  else if (e.kind === "nearlyFull") useSaveState.setState({ nearlyFull: true });
  else if (e.kind === "damaged") useSaveState.setState((s) => ({ damaged: s.damaged.some((d) => d.key === e.key) ? s.damaged : [...s.damaged, { key: e.key, why: e.why }] }));
};

const locks = typeof navigator !== "undefined" && "locks" in navigator ? (navigator.locks as unknown as LockApi) : undefined;
const writer = createWriter({
  storage,
  now: () => Date.now(),
  ...(locks ? { locks } : {}),
  // another tab writing the lease stamp reaches this one at once, hidden or not (A70)
  ...(browserStorageWatch ? { watch: browserStorageWatch } : {}),
  onChange: (w) => useSaveState.setState({ role: w ? "writer" : "elsewhere" }),
});

export const saves = createSaveStore({ storage, now: () => Date.now(), isWriter: () => writer.isWriter(), onEvent });

// without Web Locks a page gives its lease up as it goes, so its own reload plays at once, and takes it back if the
// browser restores it from the back-forward cache (A8)
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => writer.leave());
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) void writer.rejoin();
  });
}

/** Whether the last good copy of a held save is one this build can read (only then is it offered). */
export function copyUsable(key: string): boolean {
  const raw = saves.read(`${key}~copy`);
  if (raw === null) return false;
  try {
    const reader = READERS[key];
    return reader ? reader(JSON.parse(raw)) === "ok" : true;
  } catch {
    return !/^\s*[[{]/.test(raw);
  }
}

/** Writes a game save (refused unless this tab plays the game; failures are reported, never thrown). */
export const saveWrite = (key: string, value: string): boolean => saves.write(key, value);
export const saveRemove = (key: string): boolean => saves.remove(key);

const STEAL = "lingxi.playHere";

/**
 * Claims the game for this tab at start. Returns whether it plays here and which saves are damaged. A tab the player
 * moved the game to ("Play here") takes it over from whichever tab had it.
 */
export async function claimTheGame(): Promise<{ playing: boolean; damaged: Held[] }> {
  let steal = false;
  try {
    steal = sessionStorage.getItem(STEAL) === "1";
    sessionStorage.removeItem(STEAL);
  } catch {
    steal = false;
  }
  const playing = await writer.acquire({ steal });
  if (!playing) {
    useSaveState.setState({ role: "elsewhere" });
    return { playing, damaged: [] };
  }
  const damaged = saves.check(READERS);
  return { playing, damaged };
}

/** Moves the game to this tab: it reloads, takes the game over, and reads the saves fresh. */
export function playHere(): void {
  try {
    sessionStorage.setItem(STEAL, "1");
  } catch {
    // without session storage the reload still asks for the game, and gets it once the other tab lets go
  }
  location.reload();
}
