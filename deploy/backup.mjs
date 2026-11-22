/**
 * The server's data, backed up once a day (run by pm2 at 03:30; see pm2.config.cjs):
 *   1. copied to a dated folder outside the repo (kept 14 days), which survives a bad write or a deleted file;
 *   2. copied to Google Drive with rclone and checked file by file, which survives the disk.
 * Each run writes what happened to `last.json` beside the copies; the server's /api/health reads it, so a backup
 * that stopped working shows up in the status check rather than on the day it is needed.
 *
 *   node deploy/backup.mjs            LINGXI_BACKUP_DIR and LINGXI_BACKUP_REMOTE override the defaults
 *   node deploy/backup.mjs --restore <date> <target folder>
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.LINGXI_DATA_DIR ?? join(root, "services", "api", "data");
const DIR = process.env.LINGXI_BACKUP_DIR ?? join(homedir(), "lingxi-backups");
const REMOTE = process.env.LINGXI_BACKUP_REMOTE ?? "gdrive:lingxi-backups";
const KEEP_DAYS = 14;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sizeOf = (d) => walk(d).reduce((n, f) => n + statSync(f).size, 0);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** a file that lives only inside a save: written, flushed, then renamed into place (services/api/src/durable.ts) */
const transient = (f) => f.endsWith(".tmp");

/**
 * Copies the data folder file by file while the server runs. A save renames the store to `.bak` and its `.tmp` into
 * place, so a file listed a moment ago can be mid-rename: each one is retried briefly, and one that is gone for good
 * (a `.bak` the next save replaced) is skipped. A recursive copy stopped at the first such file (2026-11-21: 8 of 47).
 * Returns the files copied and those that existed at the end but were not copied (which must be none).
 */
function copyData(from, to) {
  const copied = new Set();
  for (const f of walk(from).filter((x) => !transient(x))) {
    const rel = relative(from, f);
    const out = join(to, rel);
    mkdirSync(dirname(out), { recursive: true });
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        copyFileSync(f, out);
        copied.add(rel);
        break;
      } catch (e) {
        if (e.code !== "ENOENT" && e.code !== "EBUSY" && e.code !== "EPERM") throw e;
        pause(100);
      }
    }
  }
  const missing = walk(from).filter((x) => !transient(x) && !copied.has(relative(from, x)));
  return { copied: copied.size, missing };
}

if (process.argv[2] === "--restore") {
  const [, , , date, target] = process.argv;
  if (!date || !target) throw new Error("usage: --restore <YYYY-MM-DD> <target folder>");
  const local = join(DIR, date);
  if (existsSync(local)) cpSync(local, target, { recursive: true });
  else execFileSync("rclone", ["copy", `${REMOTE}/${date}`, target], { stdio: "inherit" });
  process.stdout.write(`restored ${date} into ${target}: ${walk(target).length} files\n`);
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const dest = join(DIR, date);
const status = { at: new Date().toISOString(), date, files: 0, bytes: 0, local: false, drive: false, error: null };
try {
  mkdirSync(DIR, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  const { copied, missing } = copyData(DATA, dest);
  status.files = copied;
  status.bytes = sizeOf(dest);
  // every file the server keeps was copied: one that appeared after the walk (a new store) is copied too, or named
  for (const f of missing) {
    try {
      const out = join(dest, relative(DATA, f));
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(f, out);
      status.files++;
    } catch {
      // checked below
    }
  }
  const left = walk(DATA).filter((x) => !transient(x) && !existsSync(join(dest, relative(DATA, x))));
  status.local = left.length === 0;
  if (left.length) throw new Error(`not copied: ${left.slice(0, 5).map((x) => relative(DATA, x)).join(", ")}`);
  // older copies than two weeks go; Drive keeps every day
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const d of readdirSync(DIR)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Date.parse(d) < cutoff) rmSync(join(DIR, d), { recursive: true, force: true });
  execFileSync("rclone", ["copy", dest, `${REMOTE}/${date}`], { stdio: "pipe" });
  // the same files, the same sizes, or it does not count
  execFileSync("rclone", ["check", dest, `${REMOTE}/${date}`, "--size-only", "--one-way"], { stdio: "pipe" });
  status.drive = true;
} catch (e) {
  status.error = String(e.stderr ?? e.message ?? e).split("\n").filter((l) => !/NOTICE/.test(l)).join(" ").slice(0, 300);
}
writeFileSync(join(DIR, "last.json"), JSON.stringify(status, null, 1));
process.stdout.write(`${JSON.stringify(status)}\n`);
process.exit(status.local && status.drive ? 0 : 1);
