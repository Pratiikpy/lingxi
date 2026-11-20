/** A84: the season's recompute is fought in a worker, never on the page's main thread. */
import { describe, expect, it } from "vitest";
import { petCard, seasonStandings, standingsDigest, type SeasonEntry } from "@lingxi/game";
import { refight, type WorkerLike } from "./seasonCheck";

const entry = (i: number): SeasonEntry => ({ key: `k${i}`, at: i, pet: { name: `P${i}`, line: (["gentle", "bold", "curious"] as const)[i % 3]!, stage: "adult", story: { days: 9, lessons: 1, nature: [] }, card: petCard({ lessons: [{ when: { hunger: [i % 4] }, then: { want: i % 8, mood: 1 } }] } as never) } });
const job = { week: "2026-W47", entries: [0, 1, 2, 3].map(entry) };
const expected = standingsDigest(seasonStandings(job.week, job.entries));

describe("recomputing the season (A84)", () => {
  it("hands the week and its entries to a worker, and gives back the worker's fingerprint", async () => {
    const posted: unknown[] = [];
    let ended = false;
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(m) {
        posted.push(m);
        // the worker fights them, off the page
        const { week, entries } = m as typeof job;
        queueMicrotask(() => this.onmessage?.({ data: { digest: standingsDigest(seasonStandings(week, entries)) } } as MessageEvent));
      },
      terminate: () => void (ended = true),
    };
    const r = refight(job, () => worker);
    expect(await r.done).toBe(expected);
    expect(posted).toEqual([job]);
    expect(ended, "the worker is ended once it has answered").toBe(true);
  });

  it("without workers, still gives the same fingerprint; a worker that fails is not a different table", async () => {
    expect(await refight(job, () => null).done).toBe(expected);
    const broken: WorkerLike = { onmessage: null, onerror: null, postMessage() { queueMicrotask(() => this.onerror?.(new Event("error") as ErrorEvent)); }, terminate() {} };
    expect(await refight(job, () => broken).done).toBe(expected);
  });

  it("stopped (the sheet closed), it ends the worker and says nothing more", async () => {
    let ended = false;
    const silent: WorkerLike = { onmessage: null, onerror: null, postMessage() {}, terminate: () => void (ended = true) };
    const r = refight(job, () => silent);
    r.stop();
    await expect(r.done).rejects.toThrow(/stopped/);
    expect(ended).toBe(true);
  });
});
