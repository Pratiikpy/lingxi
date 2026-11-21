/** The diary hash worker (A114, A145): published diaries' hash chains, one after another, off the server's request thread. */
import { parentPort } from "node:worker_threads";
import { ZERO_HASH, chainAll } from "@lingxi/game";

parentPort!.on("message", ({ id, words }: { id: number; words: Uint16Array }) => {
  try {
    parentPort!.postMessage({ id, hash: chainAll(ZERO_HASH, words) });
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
