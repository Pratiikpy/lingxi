/**
 * A32: what a duel link carries. With the live server, a short token (`s.<id>`, the id being the start of the code's
 * SHA-256); without it, the code itself. A token is resolved only to a code that hashes back to it.
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_DUEL_RESULT_CODE, duelLinkId, encodeChallenge, petCard, type DuelPet } from "@lingxi/game";
import { linkToken, tokenCode } from "./duelLinks";
import { MAX_GO_FRAGMENT, followGoLink } from "./links";

const pet: DuelPet = { name: "Mochi", line: "gentle", stage: "adult", card: petCard({ lessons: [] }), story: { days: 9, lessons: 0, nature: [] } };
const code = encodeChallenge({ id: "abcdef0123456789", from: pet, at: 1 });
const answering = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
const down = (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;

describe("what a duel link carries (A32)", () => {
  it("is a short token when the server keeps the code", async () => {
    const id = await duelLinkId(code);
    const token = await linkToken(code, answering({ ok: true, id }));
    expect(token).toBe(`s.${id}`);
    expect(token.length).toBeLessThan(20);
  });

  it("is the code itself when the server cannot keep it, or answers with an id that is not the code's", async () => {
    expect(await linkToken(code, down)).toBe(code);
    expect(await linkToken(code, answering({ ok: false }, false))).toBe(code);
    expect(await linkToken(code, answering({ ok: true, id: "AAAAAAAAAAAAAAAA" }))).toBe(code);
  });

  it("resolves a token only to a code that hashes back to it", async () => {
    const id = await duelLinkId(code);
    expect(await tokenCode(`s.${id}`, answering({ ok: true, code }))).toBe(code);
    const other = encodeChallenge({ id: "fedcba9876543210", from: pet, at: 1 });
    expect(await tokenCode(`s.${id}`, answering({ ok: true, code: other }))).toBeNull();
    expect(await tokenCode(`s.${id}`, down)).toBeNull();
    // an inline code is its own answer
    expect(await tokenCode(code, down)).toBe(code);
  });
});

describe("a whole duel result through the on-chain copy's landing page (A32)", () => {
  it("is followed to the game, however long two full cards make it", () => {
    expect(MAX_GO_FRAGMENT).toBeGreaterThanOrEqual("duelr=".length + MAX_DUEL_RESULT_CODE);
    const replace = vi.fn();
    const fragment = `duelr=lxr1.${"A".repeat(MAX_DUEL_RESULT_CODE - 5)}`;
    vi.stubGlobal("location", { hash: `#go=play.html~${fragment}`, replace });
    try {
      expect(followGoLink()).toBe(true);
      expect(replace).toHaveBeenCalledWith(`play.html#${fragment}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

