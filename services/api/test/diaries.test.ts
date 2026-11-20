import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { DIARY_FLOOR_WORDS, DIARY_WORDS_PER_MINUTE, createDiaryStore } from "../src/diaries";
import { withDiaries } from "../src/server";

const words = [0x1234, 0x0001, 0xffff, 0x2a2a];
const log = { petId: "7", words, segments: [{ brainId: "1", words: words.slice(0, 2) }, { brainId: "9", words: words.slice(2) }] };
const hash = chainAll(ZERO_HASH, words);
const NOW = Date.UTC(2026, 10, 20, 12);
/** A pet hatched on chain `days` ago, with `logHash` saved. */
const onChain = (logHash: string, days = 30) => ({ logHash, born: Math.floor(NOW / 1000) - days * 86_400 });
const longLog = (petId: string, n: number) => {
  const w = Array.from({ length: n }, (_, i) => (i * 7919 + Number(petId)) & 0xffff);
  return { log: { petId, words: w, segments: [{ brainId: "1", words: w }] }, hash: chainAll(ZERO_HASH, w) };
};
const tmp = () => mkdtempSync(join(tmpdir(), "lx-diary-"));

describe("public diaries", () => {
  it("keeps a log only when it hashes to the chain's saved log hash", () => {
    const store = createDiaryStore(tmp(), { now: () => NOW });
    expect(store.publish(log, onChain("0x" + "ab".repeat(32)), "a")).toEqual({ ok: false, reason: "mismatch" });
    expect(store.publish(log, null, "a")).toEqual({ ok: false, reason: "unknown" });
    expect(store.publish({ ...log, segments: [{ brainId: "1", words: words.slice(0, 3) }] }, onChain(hash), "a")).toEqual({ ok: false, reason: "invalid" });
    expect(store.publish({ ...log, words: [70000] }, onChain(hash), "a")).toEqual({ ok: false, reason: "invalid" });
    expect(store.publish(log, onChain(hash), "a")).toEqual({ ok: true, beats: 4 });
    expect(store.get("7")?.words).toEqual(words);
    // a shorter log never replaces a longer one
    const short = { petId: "7", words: words.slice(0, 2), segments: [{ brainId: "1", words: words.slice(0, 2) }] };
    expect(store.publish(short, onChain(chainAll(ZERO_HASH, words.slice(0, 2))), "a")).toEqual({ ok: false, reason: "older" });
  });

  it("serves it to anyone, streamed from its file, and refuses a log for another pet's page", async () => {
    const store = createDiaryStore(tmp(), { now: () => NOW });
    const app = withDiaries(new Hono(), store, async (id) => (id === "7" ? onChain(hash) : null));
    const post = (id: string, body: unknown) => app.request(`/api/pets/${id}/log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("8", log)).status).toBe(400);
    expect((await post("7", log)).status).toBe(200);
    const r = await app.request("/api/pets/7/log");
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    const j = (await r.json()) as { ok: boolean; log: { words: number[] } };
    expect(j.ok && j.log.words).toEqual(words);
    expect(((await (await app.request("/api/pets/8/log")).json()) as { ok: boolean }).ok).toBe(false);
  });
});

describe("diaries bounded (A39)", () => {
  it("holds no log in memory: what it keeps is read from its file when asked", () => {
    const dir = tmp();
    const store = createDiaryStore(dir, { now: () => NOW });
    const { log: big, hash: h } = longLog("11", 8_000);
    expect(store.publish(big, onChain(h), "a")).toEqual({ ok: true, beats: 8_000 });
    // a fresh store over the same folder reads it back: nothing lived only in memory
    expect(createDiaryStore(dir, { now: () => NOW }).get("11")?.words.length).toBe(8_000);
    expect(store.heldInMemory()).toBe(0);
  });

  it("refuses a log longer than its pet has lived on chain, and takes one as long", () => {
    const store = createDiaryStore(tmp(), { now: () => NOW });
    // hatched an hour ago: 600 words a minute's worth, but never fewer than the floor
    const hourOld = { born: Math.floor(NOW / 1000) - 3600 };
    const atFloor = longLog("21", DIARY_FLOOR_WORDS);
    expect(store.publish(atFloor.log, { ...hourOld, logHash: atFloor.hash }, "a")).toEqual({ ok: true, beats: DIARY_FLOOR_WORDS });
    const past = longLog("22", DIARY_FLOOR_WORDS + 1);
    expect(store.publish(past.log, { ...hourOld, logHash: past.hash }, "a")).toEqual({ ok: false, reason: "tooLong" });
    // past the floor, a pet may hold ten words for each minute it has lived: nine hours is 5,400, and not one more
    const nineHours = { born: Math.floor(NOW / 1000) - 9 * 3600 };
    const most = 9 * 60 * DIARY_WORDS_PER_MINUTE;
    expect(most).toBeGreaterThan(DIARY_FLOOR_WORDS);
    const fits = longLog("23", most);
    expect(store.publish(fits.log, { ...nineHours, logHash: fits.hash }, "a")).toEqual({ ok: true, beats: most });
    const over = longLog("24", most + 1);
    expect(store.publish(over.log, { ...nineHours, logHash: over.hash }, "a")).toEqual({ ok: false, reason: "tooLong" });
  });

  it("takes the pet's age on the chain's clock, not this server's: a chain running a day behind does not age the pet", () => {
    const store = createDiaryStore(tmp(), { now: () => NOW });
    const chainNow = Math.floor(NOW / 1000) - 86_400;
    // hatched a minute ago by the chain's clock, a day and a minute ago by the server's
    const past = longLog("25", DIARY_FLOOR_WORDS + 500);
    expect(store.publish(past.log, { logHash: past.hash, born: chainNow - 60, at: chainNow }, "a")).toEqual({ ok: false, reason: "tooLong" });
  });

  it("an address may publish only so much a day, counting only what a republish adds", () => {
    // a log of 8,000 words is about 96,000 bytes of JSON: one fits an address's day of 150,000, two do not
    const store = createDiaryStore(tmp(), { now: () => NOW, perAddressBytesPerDay: 150_000 });
    const a = longLog("31", 8_000);
    expect(store.publish(a.log, onChain(a.hash), "1.2.3.4").ok).toBe(true);
    const b = longLog("32", 8_000);
    expect(store.publish(b.log, onChain(b.hash), "1.2.3.4")).toEqual({ ok: false, reason: "busy" });
    expect(store.publish(b.log, onChain(b.hash), "5.6.7.8").ok, "another address is not held up").toBe(true);
  });

  it("a full shelf takes a new diary by letting the least recently published or read go, and keeps that order across a restart (A80)", () => {
    const dir = tmp();
    let t = NOW;
    const size = JSON.stringify(longLog("41", 8_000).log).length;
    const store = createDiaryStore(dir, { now: () => t, totalBytes: size * 2 + 1_000 });
    for (const id of ["41", "42"]) {
      const d = longLog(id, 8_000);
      expect(store.publish(d.log, onChain(d.hash), `addr-${id}`).ok).toBe(true);
      t += 120_000;
    }
    // 41 is read: it keeps its place
    expect(store.where("41")).not.toBeNull();
    t += 120_000;
    const c = longLog("43", 8_000);
    expect(store.publish(c.log, onChain(c.hash), "addr-43")).toEqual({ ok: true, beats: 8_000 });
    expect([store.get("41") !== null, store.get("42") !== null, store.get("43") !== null], "42 went").toEqual([true, false, true]);
    // after a restart the order holds: 41 was read before 43 was published, so 41 is now the one quiet longest
    t += 120_000;
    const again = createDiaryStore(dir, { now: () => t, totalBytes: size * 2 + 1_000 });
    const d = longLog("44", 8_000);
    expect(again.publish(d.log, onChain(d.hash), "addr-44").ok).toBe(true);
    expect([again.get("41") !== null, again.get("43") !== null, again.get("44") !== null], "41, quiet longest, went").toEqual([false, true, true]);
  });

  it("opens a folder of large diaries without reading them, and still refuses a shorter republish (A80)", () => {
    const dir = tmp();
    // one large diary, kept under six names (building six is slow under coverage, and only the first is read again)
    const big = JSON.stringify(longLog("50", 100_000).log);
    for (let i = 0; i < 6; i++) writeFileSync(join(dir, `${50 + i}.json`), big);
    // against reading and parsing those files, which the old start did and more: a relative bound holds on a slow or
    // instrumented machine where a fixed one does not
    const readStarted = performance.now();
    for (const name of readdirSync(dir)) JSON.parse(readFileSync(join(dir, name), "utf8"));
    const reading = performance.now() - readStarted;
    const started = performance.now();
    const store = createDiaryStore(dir, { now: () => NOW });
    expect(performance.now() - started, "no diary is read to open the shelf").toBeLessThan(reading / 2);
    expect(store.stats().diaries).toBe(6);
    const shorter = longLog("50", 10);
    expect(store.publish(shorter.log, onChain(shorter.hash), "x")).toEqual({ ok: false, reason: "older" });
  });

  it("reads the diaries written before (one PublishedLog per file)", () => {
    const dir = tmp();
    writeFileSync(join(dir, "1.json"), JSON.stringify(log));
    const store = createDiaryStore(dir, { now: () => NOW });
    expect(store.get("1")?.words).toEqual(words);
    expect(store.stats()).toMatchObject({ diaries: 1 });
  });

  it("answers a refusal a player can meet with ok: false, not an error a browser would log", async () => {
    const store = createDiaryStore(tmp(), { now: () => NOW, perAddressBytesPerDay: 10 });
    const app = withDiaries(new Hono(), store, async () => onChain(hash));
    const r = await app.request("/api/pets/7/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(log) });
    expect([r.status, await r.json()]).toEqual([200, { ok: false, reason: "busy" }]);
  });
});
