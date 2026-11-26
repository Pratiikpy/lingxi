/**
 * Rotates the logs pm2 writes on this PC (P8; run by the watchdog). A log past `maxBytes` is copied, compressed, to
 * `<name>.<UTC stamp>.gz` beside it, and the live file is emptied in place: pm2 holds it open and appends, so the next
 * line lands at the start of the emptied file and nothing has to restart. Only the newest `keep` copies of each log are
 * kept. Files that are not `.log` are never touched.
 */

import { existsSync, readFileSync, readdirSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** A UTC time as 20261126T030000Z: sorts by time, and is safe in a file name on Windows. */
const stampOf = (ms) =>
  new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");

/**
 * Rotates every `.log` in `dir` larger than `maxBytes`, keeping `keep` compressed copies of each.
 * @param {string} dir
 * @param {{ maxBytes: number, keep: number, now?: number }} o
 * @returns {string[]} the logs rotated this time
 */
export function rotateLogs(dir, { maxBytes, keep, now = Date.now() }) {
  if (!existsSync(dir)) return [];
  const rotated = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".log")) continue;
    const file = join(dir, name);
    if (statSync(file).size <= maxBytes) continue;
    writeFileSync(join(dir, `${name}.${stampOf(now)}.gz`), gzipSync(readFileSync(file)));
    truncateSync(file, 0);
    rotated.push(name);
    const old = readdirSync(dir)
      .filter((f) => f.startsWith(`${name}.`) && f.endsWith(".gz"))
      .sort();
    for (const f of old.slice(0, Math.max(0, old.length - keep))) unlinkSync(join(dir, f));
  }
  return rotated;
}
