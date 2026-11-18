/**
 * Keeps the PC-hosted site answering (run by pm2, see pm2.config.cjs). Every minute it asks the server's health here
 * and the site's health from outside, and by watchdog-rules.mjs restarts the server when it hangs or the tunnel when
 * it goes stale. Each beat's result is written to ~/lingxi-watchdog.json, which /api/health reports.
 */

import { execFile } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decide, initialWatch } from "./watchdog-rules.mjs";

const LOCAL = process.env.LINGXI_WATCH_LOCAL ?? "http://127.0.0.1:8790/api/health";
const PUBLIC = process.env.LINGXI_WATCH_PUBLIC ?? "https://lingxi.knole.me/api/health";
const BEAT_MS = 60_000;
const STATUS = join(homedir(), "lingxi-watchdog.json");

async function answers(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

const restart = (name) =>
  new Promise((resolve) => {
    // pm2 is installed for the whole user (the logon task resurrects it the same way)
    execFile("cmd.exe", ["/c", "pm2", "restart", name], { windowsHide: true }, (err, out) => resolve(err ? `failed: ${err.message.split("\n")[0]}` : out.trim().split("\n").at(-1) ?? "done"));
  });

let watch = initialWatch();
let last = { action: null, at: null, result: null };
async function beat() {
  const now = Date.now();
  const [local, pub] = await Promise.all([answers(LOCAL), answers(PUBLIC)]);
  const r = decide(watch, { local, public: pub }, now);
  watch = r.watch;
  if (r.action) {
    const result = await restart(r.action === "restart-server" ? "lingxi-server" : "lingxi-tunnel");
    last = { action: r.action, at: new Date(now).toISOString(), result };
    process.stdout.write(`${last.at} ${r.action}: ${result}\n`);
  }
  try {
    writeFileSync(`${STATUS}.tmp`, JSON.stringify({ at: new Date(now).toISOString(), local, public: pub, ...watch, last }));
    renameSync(`${STATUS}.tmp`, STATUS);
  } catch (e) {
    process.stderr.write(`watchdog status not written: ${e.message}\n`);
  }
}

await beat();
setInterval(() => void beat().catch((e) => process.stderr.write(`watchdog beat failed: ${e.message}\n`)), BEAT_MS);
