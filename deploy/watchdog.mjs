/**
 * Keeps the PC-hosted site answering (run by pm2, see pm2.config.cjs). Every minute it asks the server's health here
 * and the site's health from outside, and by watchdog-rules.mjs restarts the server when it hangs or the tunnel when
 * it goes stale. Each beat's result is written to ~/lingxi-watchdog.json, which /api/health reports.
 */

import { execFile } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decide, describeBeat, initialWatch } from "./watchdog-rules.mjs";
import { rotateLogs } from "./logRotate.mjs";

const LOCAL = process.env.LINGXI_WATCH_LOCAL ?? "http://127.0.0.1:8790/api/health";
const PUBLIC = process.env.LINGXI_WATCH_PUBLIC ?? "https://lingxi.knole.me/api/health";
const BEAT_MS = 60_000;
const STATUS = join(homedir(), "lingxi-watchdog.json");
// P8: pm2's logs are rotated once an hour: past 5 MB a log is kept compressed and dated, five of each at most
const LOGS = process.env.LINGXI_PM2_LOGS ?? join(homedir(), ".pm2", "logs");
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOGS_KEPT = 5;
const ROTATE_EVERY_BEATS = 60;

/** What a health check answered: "ok", "refused" (nothing listening), "timed out", or the HTTP status or failure. */
async function answers(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } });
    if (!r.ok) return String(r.status);
    return (await r.json()).ok === true ? "ok" : "not ok";
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timed out";
    const code = e?.cause?.code;
    return code === "ECONNREFUSED" ? "refused" : code ? String(code).toLowerCase() : "failed";
  }
}

const restart = (name) =>
  new Promise((resolve) => {
    // pm2 is installed for the whole user (the logon task resurrects it the same way)
    execFile("cmd.exe", ["/c", "pm2", "restart", name], { windowsHide: true }, (err) =>
      resolve(err ? `failed: ${err.message.split("\n")[0]}` : `restarted ${name}`),
    );
  });

let watch = initialWatch();
let last = { action: null, at: null, result: null };
async function beat() {
  const now = Date.now();
  const [localWhy, pubWhy] = await Promise.all([answers(LOCAL), answers(PUBLIC)]);
  const local = localWhy === "ok";
  const pub = pubWhy === "ok";
  const r = decide(watch, { local: local || (localWhy === "timed out" ? "slow" : false), public: pub }, now);
  watch = r.watch;
  // P3b: every missed beat is written down with its reason, so an outage can be read afterwards
  if (!local || !pub)
    process.stdout
      .write(`${new Date(now).toISOString()} missed: ${describeBeat({ local: localWhy, public: pubWhy })} (${watch.localFails} here, ${watch.publicFails} outside in a row)
`);
  if (r.action) {
    const result = await restart(r.action === "restart-server" ? "lingxi-server" : "lingxi-tunnel");
    last = { action: r.action, at: new Date(now).toISOString(), result };
    process.stdout.write(`${last.at} ${r.action}: ${result}\n`);
  }
  try {
    writeFileSync(
      `${STATUS}.tmp`,
      JSON.stringify({
        at: new Date(now).toISOString(),
        local,
        public: pub,
        why: { local: localWhy, public: pubWhy },
        ...watch,
        last,
      }),
    );
    renameSync(`${STATUS}.tmp`, STATUS);
  } catch (e) {
    process.stderr.write(`watchdog status not written: ${e.message}\n`);
  }
}

/** Rotates pm2's logs; a failure is written down and tried again at the next hour, never stopping the watch. */
function rotate() {
  try {
    const done = rotateLogs(LOGS, { maxBytes: LOG_MAX_BYTES, keep: LOGS_KEPT });
    if (done.length) process.stdout.write(`${new Date().toISOString()} rotated: ${done.join(", ")}\n`);
  } catch (e) {
    process.stderr.write(`log rotation failed: ${e.message}\n`);
  }
}

let beats = 0;
await beat();
rotate();
setInterval(() => {
  void beat().catch((e) => process.stderr.write(`watchdog beat failed: ${e.message}\n`));
  if (++beats % ROTATE_EVERY_BEATS === 0) rotate();
}, BEAT_MS);
