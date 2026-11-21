/**
 * This player's TapeRelay address for pet letters (H13), read straight from the save without loading the relay client:
 * the live room shares it in presence. Null until the player's relay identity has been made (letters.ts).
 */

import { isRelayAddress } from "@lingxi/game";

export const LETTERS_KEY = "lingxi.letters.v1";

export function relayAddress(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LETTERS_KEY) ?? "null") as { account?: unknown } | null;
    return v && isRelayAddress(v.account) ? v.account : null;
  } catch {
    return null;
  }
}
