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

/** Starts `command` with its output in `log`; on Linux in its own process group, so it can be stopped as a whole. */
export function start(name: string, command: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; log: string }): Started & { child: ChildProcess } {
  const out = createWriteStream(o.log, { flags: "a" });
  const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  if (!child.pid) throw new Error(`${name} did not start: ${command}`);
  return { name, pid: child.pid, log: o.log, child };
}

/** Stops a process and everything it started. A process already gone is fine. */
export function stop(p: Pick<Started, "pid" | "name">): void {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-p.pid, "SIGTERM");
  } catch {
    // already gone
  }
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
