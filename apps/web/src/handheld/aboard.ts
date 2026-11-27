/**
 * Whether a pet is on its way aboard as the handheld opens: one waits in its inbox, or one was aboard before a reload
 * (handheldKeys.ts). Until the firmware has started, the page says it is bringing that pet aboard rather than only
 * waking up. R39: the page is also rendered at build time, where there is no storage, once for each answer; that render
 * names its answer through `PrerenderAboard`, and the page's first script picks the one this browser's storage gives.
 */
import { createContext } from "react";
import { DEVICE_KEY, INBOX_KEY } from "../game/handheldKeys";

/** The storage keys whose presence means a pet is coming aboard. */
export const ABOARD_KEYS: readonly string[] = [INBOX_KEY, DEVICE_KEY];

/** The answer a build-time render gives; null in a browser, which reads its storage. */
export const PrerenderAboard = createContext<boolean | null>(null);

/** Read from this browser's storage; a storage that cannot be read holds no pet. */
export function petComingAboard(): boolean {
  try {
    return ABOARD_KEYS.some((k) => localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}
