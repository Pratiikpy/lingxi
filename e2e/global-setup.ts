import { startRun } from "./harness/run";

/** Starts the fork, the server and the game before any spec runs (see harness/run.ts). */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const run = await startRun();
  const { stopRun } = await import("./harness/run");
  return () => stopRun(run);
}
