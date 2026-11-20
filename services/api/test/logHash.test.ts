/** A114: a published diary is checked off the request thread, and junk costs the one who sends it. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { createDiaryStore } from "../src/diaries";
import { createLogHasher, hashHere } from "../src/logHash";
import { withDiaries } from "../src/server";

const NOW = Date.UTC(2026, 10, 20, 12);
const onChain = (logHash: string, days = 90) => ({ logHash, born: Math.floor(NOW / 1000) - days * 86_400 });
const junk = (petId: string, n: number) => {
  const w = Array.from({ length: n }, (_, i) => (i * 40_503 + 17) & 0xffff);
  return { petId, words: w, segments: [{ brainId: "1", words: w }] };
};
const tmp = () => mkdtempSync(join(tmpdir(), "lx-hash-"));

describe("a diary's hash is worked out off the request thread (A114)", () => {
  it("the worker's hash is the chain's", async () => {
    const words = junk("1", 2_000).words;
    expect(await createLogHasher()(words)).toBe(chainAll(ZERO_HASH, words));
  });

  it("one runs at a time and a few wait; past that, and past the budget, the answer is null, never a guess", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn(async () => {
      await gate;
      return "0x00";
    });
    const hash = createLogHasher({ run, atOnce: 1, waiting: 2 });
    const asks = [hash([1]), hash([2]), hash([3]), hash([4])];
    expect(await asks[3], "the fourth has no room").toBeNull();
    release();
    expect(await Promise.all(asks.slice(0, 3))).toEqual(["0x00", "0x00", "0x00"]);
    expect(await createLogHasher({ budgetMs: 1 })(junk("1", 100_000).words), "past its budget").toBeNull();
  });

  it("a junk post at the send limit leaves the server answering others while it is checked", async () => {
    const store = createDiaryStore(tmp(), { now: () => NOW });
    const app = withDiaries(new Hono(), store, async () => onChain("0x" + "ab".repeat(32)));
    const body = JSON.stringify(junk("5", 100_000));
    // the longest the thread went without a turn while the post was checked: a blocked thread delays every tick
    let last = performance.now();
    let stall = 0;
    const tick = setInterval(() => {
      const t = performance.now();
      stall = Math.max(stall, t - last);
      last = t;
    }, 5);
    const post = app.request("/api/pets/5/log", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" }, body });
    const answer = await post;
    clearInterval(tick);
    // the gap up to the answer counts too: a check that never yields leaves no tick at all
    stall = Math.max(stall, performance.now() - last);
    expect(stall, `the thread stalled ${Math.round(stall)} ms`).toBeLessThan(250);
    expect(await answer.json()).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("cheap bounds come before the hash, and junk is charged (A114)", () => {
  it("a log refused for its age, for being older, or for its sender's bytes is never hashed", async () => {
    const store = createDiaryStore(tmp(), { now: () => NOW, perAddressBytesPerDay: 50_000 });
    const hash = vi.fn(hashHere);
    const good = junk("3", 4_000);
    expect(await store.publishLog(good, onChain(chainAll(ZERO_HASH, good.words)), "a", hash)).toEqual({ ok: true, beats: 4_000 });
    hash.mockClear();
    // too long for a pet hatched a minute ago
    expect(await store.publishLog(junk("4", 9_000), { logHash: "0x00", born: Math.floor(NOW / 1000) - 60 }, "a", hash)).toEqual({ ok: false, reason: "tooLong" });
    // shorter than the diary kept
    expect(await store.publishLog(junk("3", 100), onChain("0x00"), "b", hash)).toEqual({ ok: false, reason: "older" });
    // more than the sender may send today
    expect(await store.publishLog(junk("6", 20_000), onChain("0x00"), "a", hash)).toEqual({ ok: false, reason: "busy" });
    expect(hash).not.toHaveBeenCalled();
  });

  it("a log that does not match spends its sender's bytes, so junk stops being hashed", async () => {
    const store = createDiaryStore(tmp(), { now: () => NOW, perAddressBytesPerDay: 100_000 });
    const hash = vi.fn(hashHere);
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await store.publishLog(junk("8", 5_000), onChain("0x" + "cd".repeat(32)), "junk-sender", hash);
      results.push(r.ok ? "ok" : r.reason);
    }
    expect(results.filter((x) => x === "mismatch").length).toBeLessThan(6);
    expect(results.at(-1)).toBe("busy");
    expect(hash.mock.calls.length, "only the posts within the budget were hashed").toBe(results.filter((x) => x === "mismatch").length);
    // another sender is not held up
    const good = junk("8", 5_000);
    const fair = await store.publishLog({ ...good, words: good.words.slice(0, 10), segments: [{ brainId: "1", words: good.words.slice(0, 10) }] }, onChain(chainAll(ZERO_HASH, good.words.slice(0, 10))), "someone-else", hash);
    expect(fair).toEqual({ ok: true, beats: 10 });
  });
});
