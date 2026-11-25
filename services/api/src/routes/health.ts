/**
 * What /api/health reports (P7: out of server.ts): the build running, the last backup, the watchdog, and the
 * stores' sizes.
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, stat } from "node:fs/promises";

/** The build this server runs, read from build.json beside the built server (P3b); "source" when run through tsx. */
export function serverBuild(): { commit: string; dirty: boolean; builtAt: string } | "source" {
  try {
    const j = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "build.json"), "utf8")) as {
      commit?: unknown;
      dirty?: unknown;
      builtAt?: unknown;
    };
    return typeof j.commit === "string"
      ? { commit: j.commit, dirty: j.dirty === true, builtAt: String(j.builtAt) }
      : "source";
  } catch {
    return "source";
  }
}

/** The numbers snapshot shipped in the repo (snapshot.ts, `pnpm numbers:snapshot`). */
export const SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../snapshots/xlayer");

/** The last daily backup (deploy/backup.mjs): how old it is and whether both copies were made. */
export function backupStatus(): { ageHours: number; local: boolean; drive: boolean; error: string | null } | null {
  try {
    const file = process.env.LINGXI_BACKUP_STATUS ?? join(homedir(), "lingxi-backups", "last.json");
    const s = JSON.parse(readFileSync(file, "utf8")) as {
      at: string;
      local: boolean;
      drive: boolean;
      error: string | null;
    };
    return {
      ageHours: Math.round(((Date.now() - Date.parse(s.at)) / 3_600_000) * 10) / 10,
      local: s.local,
      drive: s.drive,
      error: s.error,
    };
  } catch {
    return null;
  }
}

/** The watchdog's last beat (deploy/watchdog.mjs): how old it is, what it saw, and the last thing it restarted. */
export function watchdogStatus(): {
  ageSeconds: number;
  local: boolean;
  public: boolean;
  last: { action: string | null; at: string | null; result: string | null };
} | null {
  try {
    const file = process.env.LINGXI_WATCHDOG_STATUS ?? join(homedir(), "lingxi-watchdog.json");
    const s = JSON.parse(readFileSync(file, "utf8")) as {
      at: string;
      local: boolean;
      public: boolean;
      last: { action: string | null; at: string | null; result: string | null };
    };
    return {
      ageSeconds: Math.round((Date.now() - Date.parse(s.at)) / 1000),
      local: s.local,
      public: s.public,
      last: s.last,
    };
  } catch {
    return null;
  }
}

/**
 * Sizes of the server's data files and folders, in KB, so a store growing without bound shows before it hurts. Walked
 * without blocking the request thread (a folder can hold tens of thousands of files), and kept five minutes (A64).
 */
export const STORE_SIZES_MS = 5 * 60_000;

export let sizesKept: { at: number; value: Promise<Record<string, number>> } | null = null;

export function storeSizes(dir: string): Promise<Record<string, number>> {
  if (sizesKept && Date.now() - sizesKept.at < STORE_SIZES_MS) return sizesKept.value;
  const sizeOf = async (p: string): Promise<number> => {
    const st = await stat(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const f of await readdir(p)) n += await sizeOf(join(p, f));
    return n;
  };
  const value = (async () => {
    const out: Record<string, number> = {};
    try {
      for (const f of await readdir(dir)) out[f] = Math.round((await sizeOf(join(dir, f))) / 1024);
    } catch {
      // no data folder yet, or a file gone while it was read
    }
    return out;
  })();
  sizesKept = { at: Date.now(), value };
  return value;
}
