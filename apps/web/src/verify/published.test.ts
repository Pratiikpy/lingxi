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
    expect(await readPublished("https://idx", "1", answer(502, "Bad Gateway"))).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", answer(200, "<html>"))).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", answer(200, { ok: true }))).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", answer(200, { ok: false, reason: "invalid" }))).toEqual({ kind: "unread" });
    expect(await readPublished("https://idx", "1", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))))).toEqual({ kind: "unread" });
  });

  it("asks the pet's own address", async () => {
    const ask = vi.fn(answer(200, { ok: false, reason: "none" }));
    await readPublished("https://idx", "42", ask);
    expect(String((ask.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/idx\/api\/pets\/42\/log$/);
  });
});
