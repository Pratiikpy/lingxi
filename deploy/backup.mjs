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
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.LINGXI_DATA_DIR ?? join(root, "services", "api", "data");
const DIR = process.env.LINGXI_BACKUP_DIR ?? join(homedir(), "lingxi-backups");
const REMOTE = process.env.LINGXI_BACKUP_REMOTE ?? "gdrive:lingxi-backups";
const KEEP_DAYS = 14;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sizeOf = (d) => walk(d).reduce((n, f) => n + statSync(f).size, 0);

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
  cpSync(DATA, dest, { recursive: true });
  status.files = walk(dest).length;
  status.bytes = sizeOf(dest);
  status.local = status.files === walk(DATA).length;
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
