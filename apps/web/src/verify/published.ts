/**
 * A pet's published diary, as Lingxi's indexer serves it. "none" is the indexer saying the pet has no published diary;
 * anything else that is not a log (a server error, a page that is not the answer, no answer at all) is "unread", so the
 * proof page can say the diary could not be read instead of showing it as missing (A109).
 */

export interface PublishedLog {
  words: number[];
  segments: Array<{ brainId: string | null; words: number[] }>;
}

export type Published = { kind: "log"; log: PublishedLog } | { kind: "none" } | { kind: "unread" };

/**
 * Each try's budget, the tries, and the pause between them (A133): the proof page makes about fifteen server reads in
 * its first seconds, and one slow answer is not a failure, so a failed read is asked once more before it is said.
 */
const READ_MS = 15_000;
const TRIES = 2;
const PAUSE_MS = 1_500;

async function readOnce(base: string, id: string, ask: typeof fetch): Promise<Published> {
  try {
    const res = await ask(`${base}/api/pets/${id}/log`, { signal: AbortSignal.timeout(READ_MS) });
    if (!res.ok) return { kind: "unread" };
    const r = (await res.json()) as { ok?: boolean; reason?: string; log?: PublishedLog };
    if (r.ok === true && r.log && Array.isArray(r.log.words) && Array.isArray(r.log.segments)) return { kind: "log", log: r.log };
    if (r.ok === false && r.reason === "none") return { kind: "none" };
    return { kind: "unread" };
  } catch {
    return { kind: "unread" };
  }
}

export async function readPublished(base: string, id: string, ask: typeof fetch = fetch, opts: { pauseMs?: number } = {}): Promise<Published> {
  let got: Published = { kind: "unread" };
  for (let i = 0; i < TRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, opts.pauseMs ?? PAUSE_MS));
    got = await readOnce(base, id, ask);
    if (got.kind !== "unread") return got;
  }
  return got;
}
