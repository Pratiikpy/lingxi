import { describe, expect, it, vi } from "vitest";
import { readPublished } from "./published";

const answer = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("a pet's published diary is read, and a failed read is told apart from no diary (A109)", () => {
  it("returns the log when the indexer has one", async () => {
    const log = { words: [1, 2], segments: [{ brainId: null, words: [1, 2] }] };
    expect(await readPublished("https://idx", "1", answer(200, { ok: true, log }))).toEqual({ kind: "log", log });
  });

  it("says there is none only when the indexer says so", async () => {
    expect(await readPublished("https://idx", "1", answer(200, { ok: false, reason: "none" }))).toEqual({ kind: "none" });
  });

  it("says it could not be read on a server error, a body that is not the answer, or no answer at all", async () => {
    expect(await readPublished("https://idx", "1", answer(502, "Bad Gateway"), { pauseMs: 0 })).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", answer(200, "<html>"), { pauseMs: 0 })).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", answer(200, { ok: true }), { pauseMs: 0 })).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", answer(200, { ok: false, reason: "invalid" }), { pauseMs: 0 })).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))), { pauseMs: 0 })).toEqual({ kind: "unread" });
  });

  it("asks once more by itself when a read fails, so one slow answer is not a failure (A133)", async () => {
    const log = { words: [1], segments: [{ brainId: null, words: [1] }] };
    const answers = [answer(502, "Bad Gateway"), answer(200, { ok: true, log })];
    const ask = vi.fn(async () => answers.shift()!());
    expect(await readPublished("https://idx", "1", ask, { pauseMs: 0 })).toEqual({ kind: "log", log });
    expect(ask).toHaveBeenCalledTimes(2);
    // "none" is an answer, never asked again
    const none = vi.fn(answer(200, { ok: false, reason: "none" }));
    expect(await readPublished("https://idx", "1", none, { pauseMs: 0 })).toEqual({ kind: "none" });
    expect(none).toHaveBeenCalledTimes(1);
    // two failures in a row are said as such
    const down = vi.fn(answer(502, "x"));
    expect(await readPublished("https://idx", "1", down, { pauseMs: 0 })).toEqual({ kind: "unread" });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("asks the pet's own address", async () => {
    const ask = vi.fn(answer(200, { ok: false, reason: "none" }));
    await readPublished("https://idx", "42", ask);
    expect(String((ask.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/idx\/api\/pets\/42\/log$/);
  });
});
