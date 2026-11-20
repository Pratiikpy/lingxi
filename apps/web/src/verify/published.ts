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

const READ_MS = 8000;

export async function readPublished(base: string, id: string, ask: typeof fetch = fetch): Promise<Published> {
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
