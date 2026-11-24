/**
 * The browser handheld runs in one tab at a time (P1), with its own lock beside the game's: the handheld keeps its own
 * memory in storage (handheldKeys.ts DEVICE_KEY), and two handheld tabs would write over each other's. The game and the
 * handheld still hand the pet across in two tabs, as designed.
 */

import { type LockApi, type LockQuery, browserStorageWatch, createWriter, heldElsewhere } from "./writer";

const STEAL = "lingxi.handheldHere";
let lost: (() => void) | null = null;

const storage =
  typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
const writer = createWriter({
  lockName: "lingxi-handheld",
  stampKey: "lingxi.handheld.lease",
  storage,
  now: () => Date.now(),
  ...(typeof navigator !== "undefined" && "locks" in navigator ? { locks: navigator.locks as unknown as LockApi } : {}),
  ...(browserStorageWatch ? { watch: browserStorageWatch } : {}),
  onChange: (mine) => {
    if (!mine) lost?.();
  },
});

// without Web Locks the handheld gives its lease up as the page goes, and takes it back from the back-forward cache (A8)
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => writer.leave());
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) void writer.rejoin();
  });
}

/** Claims the handheld for this tab at start; a tab the player moved it to takes it over. */
export async function claimHandheld(): Promise<boolean> {
  let steal = false;
  try {
    steal = sessionStorage.getItem(STEAL) === "1";
    sessionStorage.removeItem(STEAL);
  } catch {
    steal = false;
  }
  return writer.acquire({ steal });
}

/** True while this tab runs the handheld: its memory is written only then. */
export const handheldIsMine = (): boolean => writer.isWriter();

/** Called once if another tab takes the handheld over. */
export const onHandheldLost = (fn: () => void): void => {
  lost = fn;
};

/** Whether the game is open in another tab of this browser (A7): that tab brings a returned pet home by itself. */
export const gameIsOpen = (): Promise<boolean> =>
  heldElsewhere({
    storage,
    now: () => Date.now(),
    ...(typeof navigator !== "undefined" && "locks" in navigator
      ? { locks: navigator.locks as unknown as LockQuery }
      : {}),
  });

/** Moves the handheld to this tab. */
export function handheldHere(): void {
  try {
    sessionStorage.setItem(STEAL, "1");
  } catch {
    // the reload still asks for the handheld, and gets it once the other tab lets go
  }
  location.reload();
}
