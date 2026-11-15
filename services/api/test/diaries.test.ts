import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ZERO_HASH, chainAll } from "@lingxi/game";
import { createDiaryStore } from "../src/diaries";
import { withDiaries } from "../src/server";

const words = [0x1234, 0x0001, 0xffff, 0x2a2a];
const log = { petId: "7", words, segments: [{ brainId: "1", words: words.slice(0, 2) }, { brainId: "9", words: words.slice(2) }] };
const hash = chainAll(ZERO_HASH, words);

describe("public diaries", () => {
  it("keeps a log only when it hashes to the chain's saved log hash", () => {
    const store = createDiaryStore(mkdtempSync(join(tmpdir(), "lx-diary-")));
    expect(store.publish(log, "0x" + "ab".repeat(32))).toEqual({ ok: false, reason: "mismatch" });
    expect(store.publish(log, null)).toEqual({ ok: false, reason: "unknown" });
    expect(store.publish({ ...log, segments: [{ brainId: "1", words: words.slice(0, 3) }] }, hash)).toEqual({ ok: false, reason: "invalid" });
    expect(store.publish({ ...log, words: [70000] }, hash)).toEqual({ ok: false, reason: "invalid" });
    expect(store.publish(log, hash)).toEqual({ ok: true, beats: 4 });
    expect(store.get("7")?.words).toEqual(words);
    // a shorter log never replaces a longer one
    const short = { petId: "7", words: words.slice(0, 2), segments: [{ brainId: "1", words: words.slice(0, 2) }] };
    expect(store.publish(short, chainAll(ZERO_HASH, words.slice(0, 2)))).toEqual({ ok: false, reason: "older" });
  });

  it("serves it to anyone and refuses a log for another pet's page", async () => {
    const store = createDiaryStore(mkdtempSync(join(tmpdir(), "lx-diary-")));
    const app = withDiaries(new Hono(), store, async (id) => (id === "7" ? hash : null));
    const post = (id: string, body: unknown) => app.request(`/api/pets/${id}/log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("8", log)).status).toBe(400);
    expect((await post("7", log)).status).toBe(200);
    const j = (await (await app.request("/api/pets/7/log")).json()) as { ok: boolean; log: { words: number[] } };
    expect(j.ok && j.log.words).toEqual(words);
    expect(((await (await app.request("/api/pets/8/log")).json()) as { ok: boolean }).ok).toBe(false);
  });
});
