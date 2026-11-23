/**
 * The processes the end-to-end suite runs (a fork, the server, the game): started with their output in a log file,
 * waited on until they answer, and stopped with everything they started, on Windows and Linux alike.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";

export interface Started {
  name: string;
  pid: number;
  log: string;
}

/** A port nothing on this machine is listening on now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port"))));
    });
  });
}

/** The processes started in this Node process, by number, so a stop can check each is still the one it started. */
const children = new Map<number, ChildProcess>();

/** Starts `command` with its output in `log`; on Linux in its own process group, so it can be stopped as a whole. */
export function start(name: string, command: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; log: string }): Started & { child: ChildProcess } {
  const out = createWriteStream(o.log, { flags: "a" });
  const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  if (!child.pid) throw new Error(`${name} did not start: ${command}`);
  children.set(child.pid, child);
  return { name, pid: child.pid, log: o.log, child };
}

/**
 * Stops a process and everything it started. A process already gone is left alone: Windows gives a dead process's
 * number to the next process that starts, so killing by number after an exit could stop someone else's (another
 * run's game server, say). The child's own handle says whether it still runs, and while that handle is open Windows
 * does not reuse its number.
 */
export function stop(p: Pick<Started, "pid" | "name"> & { child?: ChildProcess }): void {
  const child = p.child ?? children.get(p.pid);
  if (child && (child.exitCode !== null || child.signalCode !== null)) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-p.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

/**
 * Stops anvil the way it saves its fork cache (P3a): anvil writes what it fetched from X Layer to its cache only when it
 * is interrupted (SIGINT), and CI keeps that cache between runs, so a run that ended with a kill left the next to fetch
 * everything again from endpoints that answer a burst with 403. Waits up to `ms` for it to exit, then stops it hard.
 * Windows has no interrupt to send another process; there it is stopped at once.
 */
export async function stopSaving(p: Pick<Started, "pid" | "name"> & { child?: ChildProcess }, ms = 20_000): Promise<void> {
  if (process.platform === "win32") return stop(p);
  const alive = () => {
    try {
      process.kill(p.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    process.kill(-p.pid, "SIGINT");
  } catch {
    return;
  }
  const until = Date.now() + ms;
  while (alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  if (alive()) stop(p);
}

/**
 * Waits until `ready` resolves true, asking every half second, or fails after `ms` with what was last seen and the
 * end of the process's log, so a harness that cannot start says why.
 */
export async function waitFor(what: string, ready: () => Promise<boolean>, ms: number, logFile?: string): Promise<void> {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      if (await ready()) return;
      last = "not ready";
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  let tail = "";
  if (logFile) {
    try {
      const { readFileSync } = await import("node:fs");
      tail = readFileSync(logFile, "utf8").split("\n").slice(-25).join("\n");
    } catch {
      tail = "(no log)";
    }
  }
  throw new Error(`${what} did not come up in ${Math.round(ms / 1000)} s (${last})${tail ? `\n--- ${logFile}\n${tail}` : ""}`);
}

/** True when `url` answers with a status below 500. */
export async function answers(url: string, init?: RequestInit): Promise<boolean> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
  return r.status < 500;
}

/** The pinned fork of X Layer the suites run on (`e2e/fork.json`). */
export interface PinnedFork {
  block: number;
  rpc: string;
}

/**
 * anvil's arguments for a fork at the pinned block (P3a). One endpoint, with anvil's own retries and timeout: reading
 * from both official endpoints with longer timeouts and more retries was tried, and on CI it made the fork tests' own
 * requests time out. anvil logs what it does (no --silent), so a run's anvil.log shows a failed read of X Layer (the
 * endpoint answers a burst from one address with CloudFront 403, which anvil does not retry); its cache is kept between
 * CI runs (stopSaving), so few reads leave the machine. LINGXI_E2E_UPSTREAM overrides the endpoint.
 */
export function forkArgs(fork: PinnedFork, port: number): string[] {
  return ["--fork-url", process.env.LINGXI_E2E_UPSTREAM ?? fork.rpc, "--fork-block-number", String(fork.block), "--port", String(port), "--chain-id", "196"];
}
