/**
 * R17: why the server started. pm2 restarts the server when a release goes out, when the watchdog finds it hung, when
 * the PC comes back up, and when someone restarts it by hand; its log says that each happened and not which. This
 * ledger is one line for each cause as it acts (deploy/noteRestart.mjs, run by the release command and the watchdog)
 * and one for each start (the server, as it comes up). A start with a cause written shortly before it is explained by
 * it; a start with none is a reboot, a restart by hand, or something worth looking into, and the health report counts
 * them so that it is seen.
 */
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

export type LedgerWho = "release" | "watchdog" | "server";
export interface LedgerLine {
  at: string;
  who: LedgerWho;
  why: string;
}
export interface ExplainedStart {
  at: string;
  cause: "release" | "watchdog" | "unexplained";
  why: string;
}

/**
 * Where the ledger is kept, when this server keeps one: the live server is told by its pm2 settings (beside the
 * watchdog's status, outside the repo and the releases). A server started for a test or on a developer's desk is told
 * nothing and writes nothing, or its starts would be counted among the live server's as starts with no cause.
 */
export const LEDGER_FILE: string | null = process.env.LINGXI_RESTART_LEDGER ?? null;
/** A cause explains a start that follows it within this long (a build's reload takes under a minute). */
const EXPLAINS_FOR_MS = 180_000;
const MAX_BYTES = 256_000;
const WHO: readonly string[] = ["release", "watchdog", "server"];

/** One line of text: a note is one line of the ledger, whatever it was handed. */
const oneLine = (text: string): string =>
  text
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim()
    .slice(0, 200);

/** Writes one line: who acted and why. Past `maxBytes` the oldest half of the file goes. Never throws. */
export function noteRestart(
  file: string,
  who: LedgerWho,
  why: string,
  now: () => number = Date.now,
  maxBytes = MAX_BYTES,
): void {
  try {
    const line = JSON.stringify({ at: new Date(now()).toISOString(), who, why: oneLine(why) });
    appendFileSync(file, `${line}\n`);
    if (statSync(file).size > maxBytes) {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      writeFileSync(file, `${lines.slice(Math.ceil(lines.length / 2)).join("\n")}\n`);
    }
  } catch {
    // the ledger is a record, not a part the server depends on: a disk that refuses it does not stop a start
  }
}

/** The ledger's whole lines, oldest first; a line that is not one of ours is passed over. */
export function readLedger(file: string): LedgerLine[] {
  if (!existsSync(file)) return [];
  const out: LedgerLine[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    try {
      const l = JSON.parse(raw) as Partial<LedgerLine>;
      if (
        typeof l.at === "string" &&
        typeof l.why === "string" &&
        WHO.includes(l.who ?? "") &&
        !Number.isNaN(Date.parse(l.at))
      )
        out.push({ at: l.at, who: l.who as LedgerWho, why: l.why });
    } catch {
      // a torn line (the PC lost power mid-write) is not a record
    }
  }
  return out;
}

/** Each start with its cause: the last release or watchdog action written within three minutes before it. */
export function explainStarts(lines: readonly LedgerLine[]): ExplainedStart[] {
  const out: ExplainedStart[] = [];
  let cause: LedgerLine | null = null;
  for (const l of lines) {
    if (l.who !== "server") {
      cause = l;
      continue;
    }
    const explained = cause !== null && Date.parse(l.at) - Date.parse(cause.at) <= EXPLAINS_FOR_MS;
    out.push(
      explained && cause
        ? { at: l.at, cause: cause.who as "release" | "watchdog", why: cause.why }
        : { at: l.at, cause: "unexplained", why: "" },
    );
    // one cause explains one start: a second start after the same release is its own question
    cause = null;
  }
  return out;
}

/** For the health report: the last day's starts, how many had no cause, and when the last of those was. */
export function startsSummary(
  lines: readonly LedgerLine[],
  now: number = Date.now(),
): { lastDay: number; unexplained: number; lastUnexplained: string | null } {
  const day = explainStarts(lines).filter((s) => Date.parse(s.at) > now - 86_400_000);
  const none = day.filter((s) => s.cause === "unexplained");
  return { lastDay: day.length, unexplained: none.length, lastUnexplained: none.at(-1)?.at ?? null };
}
