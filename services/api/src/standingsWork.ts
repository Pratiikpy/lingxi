/** The standings worker (A38): fights one week's entries, off the server's request thread, and hands back the result. */
import { parentPort, workerData } from "node:worker_threads";
import { type SeasonEntry, seasonStandings } from "@lingxi/game";

const { week, entries } = workerData as { week: string; entries: SeasonEntry[] };
try {
  parentPort!.postMessage({ standings: seasonStandings(week, entries) });
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
