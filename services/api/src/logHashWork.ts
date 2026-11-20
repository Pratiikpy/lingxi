/** The diary hash worker (A114): a published diary's hash chain, off the server's request thread. */
import { parentPort, workerData } from "node:worker_threads";
import { ZERO_HASH, chainAll } from "@lingxi/game";

const { words } = workerData as { words: Uint16Array };
try {
  parentPort!.postMessage({ hash: chainAll(ZERO_HASH, words) });
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
