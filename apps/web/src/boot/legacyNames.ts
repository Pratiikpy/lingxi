/**
 * Runs before any store reads its save, on the page that plays the game once it holds the game (play/main.tsx): a
 * save written before the residents were renamed (2026-11-18) is rewritten once with today's names, so no friendship,
 * gift or quest is lost. Keys and session secrets are never touched; a value that is not JSON is left as it is. Pages
 * that only read (the proof page, the numbers) never wrote resident names and do not run it.
 */

import { renameLegacy } from "@lingxi/world/legacy";
import { saveWrite } from "../game/saveRuntime";

const DONE = "lingxi.names.v2";
const SECRET = /session|device/;

function migrate(): void {
  if (localStorage.getItem(DONE)) return;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("lingxi.") || SECRET.test(key)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const renamed = renameLegacy(value);
    if (renamed !== value) saveWrite(key, JSON.stringify(renamed));
  }
  saveWrite(DONE, "1");
}

/** Brings an old save's resident names up to date, once; a failure leaves it for the next visit. */
export function migrateLegacyNames(): void {
  try {
    migrate();
  } catch (e) {
    // storage blocked: the stores fall back as they always have, and the migration runs on the next visit
    console.warn("lingxi: could not update an old save's names", e);
  }
}
