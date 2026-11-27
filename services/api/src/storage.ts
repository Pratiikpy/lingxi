/**
 * Whether this server can save (R45). On 2026-11-27 the PC's disk filled and the indexer, goals, sales and circuits
 * stores failed to write (ENOSPC) while /api/health said every job was ok: a store's job logs its error and tries again
 * on its next turn, so once space came back the report forgot it. Every store writes through durable.ts's writeFlushed,
 * which notes here each write that fails; the boot names the data folder whose disk is watched. The health report gives
 * the disk's free space and the last day's failed writes, and the public answer's `store` is false while the server
 * cannot save (a write failed in the last STORE_GRACE_MS, or the disk is under DISK_ALARM_GB), so the outside check can
 * open an issue for the owner before players lose what they did.
 */
import { statfsSync } from "node:fs";
import { basename } from "node:path";

/** Less free space than this on the data disk, in GB, and the server is said to be unable to save. */
export const DISK_ALARM_GB = Number(process.env.LINGXI_DISK_ALARM_GB ?? 5);
/** A failed write makes the server unable to save for this long, unless another failure follows. */
export const STORE_GRACE_MS = 10 * 60_000;
/** How many failed writes are remembered: enough for a day of one store failing every few minutes. */
const KEPT = 500;
const DAY_MS = 24 * 60 * 60_000;
/** The disk's free space is read at most this often (the health report is asked every minute). */
const DISK_READ_MS = 30_000;

export interface WriteFailure {
  at: number;
  /** the file's own name, never its folder (the report may be read off this machine) */
  file: string;
  /** the system's error code, ENOSPC for a full disk */
  code: string;
}

let failures: WriteFailure[] = [];
let disk: { dir: string; read: (dir: string) => number | null; at: number; freeGb: number | null } | null = null;

/** Notes that writing `path` failed with `e`; called by durable.ts for every store write. */
export function noteWriteFailure(path: string, e: unknown, at = Date.now()): void {
  const code = (e as { code?: unknown } | null)?.code;
  failures = [
    ...failures.slice(-(KEPT - 1)),
    { at, file: basename(path), code: typeof code === "string" ? code : "?" },
  ];
}

/** The failed writes of the last day, and the latest one. */
export function writeFailures(now = Date.now()): { lastDay: number; last: WriteFailure | null } {
  const recent = failures.filter((f) => now - f.at < DAY_MS);
  return { lastDay: recent.length, last: recent.at(-1) ?? null };
}

/** The free space on the disk that holds `dir`, in GB, or null when it cannot be read. */
export function diskFreeGb(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1e7) / 100;
  } catch {
    // an unreadable disk reports null, and the report says so rather than guessing
    return null;
  }
}

/** Watches the disk that holds the data folder `dir` (the boot calls it; `read` stands in for the disk in tests). */
export function watchDisk(dir: string, read: (dir: string) => number | null = diskFreeGb): void {
  disk = { dir, read, at: 0, freeGb: null };
}

/** The watched disk's free space in GB, and whether it is under the alarm; null when no disk is watched. */
export function diskStatus(now = Date.now()): { freeGb: number | null; low: boolean; alarmGb: number } | null {
  if (!disk) return null;
  if (now - disk.at >= DISK_READ_MS || disk.at === 0) disk = { ...disk, at: now, freeGb: disk.read(disk.dir) };
  return { freeGb: disk.freeGb, low: disk.freeGb !== null && disk.freeGb < DISK_ALARM_GB, alarmGb: DISK_ALARM_GB };
}

/** Whether the server can save now: no write failed in the last STORE_GRACE_MS and the data disk is not low. */
export function storeOk(now = Date.now()): boolean {
  const last = failures.at(-1);
  if (last && now - last.at < STORE_GRACE_MS) return false;
  return !diskStatus(now)?.low;
}

/** Tests only: forget every failure and the watched disk. */
export function forgetStorage(): void {
  failures = [];
  disk = null;
}
