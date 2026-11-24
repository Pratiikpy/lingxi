/**
 * A pet kept on X Layer after living in the browser (A66). Its hatch records its state at that moment, and the chain's
 * proof of its memory replays a log from there: the Hatched event's memory, then the words chained into the hash each
 * save commits. So the pet's log starts again at the moment the hatch was taken: the words before it are left behind,
 * the hash is chained from zero over the words after it, the stretches (the brain each ran on) and the beat marks move
 * to the new start, and the memory there is kept so Rewind replays from where the log now begins.
 */

import { ZERO_HASH, chainAll } from "./log";
import { type Mind, rewind } from "./replay";
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

/**
 * A pet not kept on chain keeps the last thirty days of its input log (A148). Its log serves only Rewind and its diary,
 * and keeping it on chain starts the log afresh (A66), so nothing needs the words before; kept forever they grew a
 * guest's save by a word a minute and were copied on every beat. Cut once the log passes a day over the thirty, so the
 * replay that finds the memory at the cut runs about once a day.
 */
export const GUEST_LOG_KEEP = 30 * 24 * 60;
export const GUEST_LOG_MAX = GUEST_LOG_KEEP + 24 * 60;

/** `p` with its log cut to the last GUEST_LOG_KEEP words once it passes GUEST_LOG_MAX; `mindFor` is Rewind's. */
export function boundLog(
  p: Pet,
  mindFor: (
    lessons: Parameters<Parameters<typeof rewind>[1]>[0],
    outside?: Parameters<Parameters<typeof rewind>[1]>[1],
    skills?: number[],
  ) => Mind,
): Pet {
  if (p.pendingLog.length <= GUEST_LOG_MAX) return p;
  const n = p.pendingLog.length - GUEST_LOG_KEEP;
  // Rewind's own replay gives the memory just before word n: the memory the log now starts from
  const at = rewind(p, mindFor, 1, p.pendingLog.length - n - 1)[0];
  return at && at.index === n ? restartLog(p, n, at.memory) : p;
}
