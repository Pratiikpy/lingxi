/**
 * The proof page lives on its own page, so it cannot reach the game's stores. When it finds every thought of a
 * saved day matching X Layer, it leaves a mark in this browser; the game turns new marks into the
 * "proof-checked" event when it loads, and at once if it is open in another tab (the storage event).
 */

const MADE = "lingxi.proof.checked.v1";
const TAKEN = "lingxi.proof.taken.v1";

const read = (k: string): number => {
  try {
    const n = Number(localStorage.getItem(k) ?? 0);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
};

/** Called by the proof page when a full check matched. */
export function markProofChecked(): void {
  try {
    localStorage.setItem(MADE, String(read(MADE) + 1));
  } catch {
    // private mode: the mark is lost, the check itself still stands on the page
  }
}

/** Marks made since the game last looked, counted once. */
export function takeProofChecks(): number {
  const made = read(MADE);
  const taken = read(TAKEN);
  if (made <= taken) return 0;
  try {
    localStorage.setItem(TAKEN, String(made));
  } catch {
    return 0;
  }
  return made - taken;
}

export const PROOF_KEY = MADE;
