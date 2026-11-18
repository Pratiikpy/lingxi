/**
 * The browser handheld runs in one tab at a time (P1), with its own lock beside the game's: the handheld keeps its own
 * memory in storage (handheldKeys.ts DEVICE_KEY), and two handheld tabs would write over each other's. The game and the
 * handheld still hand the pet across in two tabs, as designed.
 */

import { type LockApi, createWriter } from "./writer";

const STEAL = "lingxi.handheldHere";
let lost: (() => void) | null = null;

const storage = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => undefined };
const writer = createWriter({
  lockName: "lingxi-handheld",
  stampKey: "lingxi.handheld.lease",
  storage,
  now: () => Date.now(),
  ...(typeof navigator !== "undefined" && "locks" in navigator ? { locks: navigator.locks as unknown as LockApi } : {}),
  onChange: (mine) => {
    if (!mine) lost?.();
  },
});

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

/** Moves the handheld to this tab. */
export function handheldHere(): void {
  try {
    sessionStorage.setItem(STEAL, "1");
  } catch {
    // the reload still asks for the handheld, and gets it once the other tab lets go
  }
  location.reload();
}
