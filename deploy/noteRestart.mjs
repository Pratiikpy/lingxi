/**
 * R17: writes one line in the restart ledger (services/api/src/restartLedger.ts reads it): who is about to restart the
 * server, and why. Run by the release command (`node deploy/noteRestart.mjs release`, which names the commit) and
 * called by the watchdog. The line's form is the ledger's: {"at", "who", "why"}, one to a line.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const LEDGER_FILE = process.env.LINGXI_RESTART_LEDGER ?? join(homedir(), "lingxi-restarts.log");

/** One line: every run of line breaks and control characters is a space. */
const oneLine = (text) =>
  String(text)
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim()
    .slice(0, 200);

/** Writes the line; a disk that refuses it is said on stderr and stops nothing. */
export function note(who, why, file = LEDGER_FILE) {
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), who, why: oneLine(why) })}\n`);
  } catch (e) {
    process.stderr.write(`restart ledger not written: ${e.message}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const who = process.argv[2];
  if (who !== "release") throw new Error("usage: node deploy/noteRestart.mjs release");
  let commit = "unknown commit";
  try {
    commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // released from a folder that is not a checkout: the line still says a release did it
  }
  note("release", commit);
}
