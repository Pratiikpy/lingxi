/**
 * A pet kept on X Layer after living in the browser (A66). Its hatch records its state at that moment, and the chain's
 * proof of its memory replays a log from there: the Hatched event's memory, then the words chained into the hash each
 * save commits. So the pet's log starts again at the moment the hatch was taken: the words before it are left behind,
 * the hash is chained from zero over the words after it, the stretches (the brain each ran on) and the beat marks move
 * to the new start, and the memory there is kept so Rewind replays from where the log now begins.
 */

import { ZERO_HASH, chainAll } from "./log";
import type { Pet } from "./sim";

/** `p` with its log starting after its first `n` words, where its memory was `memory`. A pet with no words is unchanged. */
export function restartLog(p: Pet, n: number, memory: readonly number[]): Pet {
  if (n <= 0) return p;
  const pendingLog = p.pendingLog.slice(n);
  const segs = p.segments ?? [{ from: 0, lessons: [] }];
  // the stretch running at the cut starts the new log; later ones move back with it
  const at = segs.reduce((k, s, i) => (s.from <= n ? i : k), 0);
  const segments = segs.slice(at).map((s, i) => ({ ...s, from: i === 0 ? 0 : s.from - n }));
  const marks = p.logMarks ?? [];
  const mk = marks.reduce((k, m, i) => (m[0] <= n ? i : k), -1);
  const logMarks: Array<[number, number]> = marks.flatMap(([from, beat], i): Array<[number, number]> => {
    if (i < mk) return [];
    if (i === mk) return [[0, beat + (n - from)]];
    return [[from - n, beat]];
  });
  return { ...p, pendingLog, logHash: chainAll(ZERO_HASH, pendingLog), segments, logMarks, logStart: memory.slice() };
}
