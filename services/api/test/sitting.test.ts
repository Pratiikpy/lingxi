import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { withSitting } from "../src/server";
import { createSittingStore, keyHashOf } from "../src/sitting";

const KEY = "c".repeat(32);
const pack = JSON.stringify({ v: 1, pet: { bornAt: 1 } });
const big = (n: number) => JSON.stringify({ v: 1, pet: { bornAt: 1 }, pad: "x".repeat(n) });

describe("pet-sitting packs", () => {
  it("leaves, collects and sends home only with the right key", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t);
    const app = withSitting(new Hono(), store);
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    const left = await (await post("/api/sit", { pack, keyHash: keyHashOf(KEY), until: t + 86_400_000 })).json();
    expect(left.ok).toBe(true);
    const got = await (await app.request(`/api/sit/${left.code}`)).json();
    expect(got).toEqual({ ok: true, pack });
    expect(await (await post(`/api/sit/${left.code}/home`, { key: "d".repeat(32), pet: "{}" })).json()).toEqual({ ok: false, reason: "refused" });
    expect(await (await post(`/api/sit/${left.code}/home`, { key: KEY, pet: '{"back":1}' })).json()).toEqual({ ok: true });
    expect((await (await app.request(`/api/sit/${left.code}`)).json()).back).toBe('{"back":1}');
    expect(await (await app.request("/api/sit/nope")).json()).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses junk packs, bad keys, impossible end dates, and forgets old sittings", async () => {
    let t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t);
    expect((await store.leave("not json", keyHashOf(KEY), t + 1000)).ok).toBe(false);
    expect((await store.leave(pack, "short", t + 1000)).ok).toBe(false);
    expect((await store.leave(pack, keyHashOf(KEY), t - 1)).ok).toBe(false);
    expect((await store.leave(pack, keyHashOf(KEY), t + 40 * 86_400_000)).ok).toBe(false);
    const r = await store.leave(pack, keyHashOf(KEY), t + 1000);
    expect(r.ok).toBe(true);
    t += 8 * 86_400_000;
    await store.leave(pack, keyHashOf(KEY), t + 1000);
    expect(await store.collect((r as { code: string }).code)).toBeNull();
  });

  it("lets one address have only a few packs waiting, and keeps all packs within their byte budget", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t, { maxBytes: 1_000_000, perOwner: 3 });
    for (let i = 0; i < 3; i++) expect((await store.leave(pack, keyHashOf(KEY), t + 1000, "203.0.113.9")).ok).toBe(true);
    expect(await store.leave(pack, keyHashOf(KEY), t + 1000, "203.0.113.9")).toEqual({ ok: false, reason: "tooMany" });
    expect((await store.leave(pack, keyHashOf(KEY), t + 1000, "198.51.100.1")).ok).toBe(true);
    // a bigger pack than the budget has left is refused, whoever sends it
    expect((await store.leave(big(500_000), keyHashOf(KEY), t + 1000, "198.51.100.2")).ok).toBe(true);
    expect(await store.leave(big(500_000), keyHashOf(KEY), t + 1000, "198.51.100.3")).toEqual({ ok: false, reason: "full" });
    expect(store.stats().bytes).toBeLessThanOrEqual(1_000_000);
  });

  it("counts every pack an address still has on the shelf, past its end date too, until it is let go (A50)", async () => {
    let t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t, { maxBytes: 1_000_000, perOwner: 3 });
    // sittings a minute long, sent one after another
    for (let i = 0; i < 3; i++) expect((await store.leave(pack, keyHashOf(KEY), t + 60_000, "203.0.113.9")).ok).toBe(true);
    t += 2 * 60_000;
    expect(await store.leave(pack, keyHashOf(KEY), t + 60_000, "203.0.113.9"), "past their end, still kept, still counted").toEqual({ ok: false, reason: "tooMany" });
    // a week after they ended they are let go, and count no more
    t += 7 * 86_400_000;
    expect((await store.leave(pack, keyHashOf(KEY), t + 60_000, "203.0.113.9")).ok).toBe(true);
  });

  it("keeps each pack in its own file and remembers them all after a restart", async () => {
    const t = 1_800_000_000_000;
    const dir = join(mkdtempSync(join(tmpdir(), "lx-sit-")), "sitting");
    const a = createSittingStore(dir, () => t);
    const r = (await a.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.9")) as { code: string };
    expect(readdirSync(dir).sort()).toEqual([`${r.code}.pack`, "index.json"]);
    const b = createSittingStore(dir, () => t);
    expect(await b.collect(r.code)).toEqual({ pack });
  });

  it("moves a store from before (one JSON file) into the new layout without losing a pack", async () => {
    const t = 1_800_000_000_000;
    const base = mkdtempSync(join(tmpdir(), "lx-sit-"));
    const legacy = join(base, "sitting.json");
    const code = "a".repeat(24);
    writeFileSync(legacy, JSON.stringify({ [code]: { pack, keyHash: keyHashOf(KEY), until: t + 86_400_000, created: t, back: '{"home":1}', backAt: t } }));
    const store = createSittingStore(legacy, () => t);
    // asked at once, before the move's files can have landed: the store answers only once its move is done (A37)
    expect(await store.collect(code)).toEqual({ pack, back: '{"home":1}', backAt: t });
    expect(existsSync(`${legacy}.migrated`)).toBe(true);
    expect(await createSittingStore(legacy, () => t).collect(code)).toEqual({ pack, back: '{"home":1}', backAt: t });
  });
});

describe("a burst cannot pass the sitting caps (A76)", () => {
  it("thirty packs left at once from one address keep to its cap", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(mkdtempSync(join(tmpdir(), "sit-")), () => t, { maxBytes: 100_000_000, perOwner: 8 });
    const got = await Promise.all(Array.from({ length: 30 }, () => store.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.76")));
    expect(got.filter((r) => r.ok)).toHaveLength(8);
    expect(got.filter((r) => !r.ok && r.reason === "tooMany")).toHaveLength(22);
    expect(store.stats().packs).toBe(8);
  });

  it("thirty addresses at once keep to the byte budget, and a pack sent home keeps to it too", async () => {
    const t = 1_800_000_000_000;
    const size = big(1_000).length;
    const store = createSittingStore(mkdtempSync(join(tmpdir(), "sit-")), () => t, { maxBytes: size * 5, perOwner: 8 });
    const got = await Promise.all(Array.from({ length: 30 }, (_, i) => store.leave(big(1_000), keyHashOf(KEY), t + 86_400_000, `198.51.100.${i}`)));
    expect(got.filter((r) => r.ok)).toHaveLength(5);
    expect(store.stats().bytes).toBeLessThanOrEqual(size * 5);
    // the shelf is full: two pets sent home at once cannot both pass it
    const codes = got.filter((r): r is { ok: true; code: string } => r.ok).map((r) => r.code);
    const back = await Promise.all(codes.slice(0, 2).map((c) => store.sendHome(c, KEY, big(1_000))));
    expect(back.filter(Boolean).length).toBeLessThanOrEqual(0);
    expect(store.stats().bytes).toBeLessThanOrEqual(size * 5);
  });

  it("two pets sent home to one code at once count its bytes once", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(mkdtempSync(join(tmpdir(), "sit-")), () => t, { maxBytes: 100_000_000, perOwner: 8 });
    const left = await store.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.77");
    if (!left.ok) throw new Error("not left");
    const before = store.stats().bytes;
    await Promise.all([store.sendHome(left.code, KEY, big(500)), store.sendHome(left.code, KEY, big(500))]);
    expect(store.stats().bytes).toBe(before + big(500).length);
  });

  it("twenty pets sent home to one code at once never collide on a file, and stray temporary files are cleared (A98)", async () => {
    const t = 1_800_000_000_000;
    const dir = mkdtempSync(join(tmpdir(), "sit-"));
    const store = createSittingStore(dir, () => t, { maxBytes: 100_000_000, perOwner: 8 });
    const left = await store.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.98");
    if (!left.ok) throw new Error("not left");
    const before = store.stats().bytes;
    const sent = await Promise.allSettled(Array.from({ length: 20 }, () => store.sendHome(left.code, KEY, big(300))));
    expect(sent.filter((r) => r.status === "rejected"), "no write failed").toEqual([]);
    expect(store.stats().bytes).toBe(before + big(300).length);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp")), "nothing left half-written").toEqual([]);
    writeFileSync(join(dir, `${left.code}.back.abc.tmp`), "half");
    createSittingStore(dir, () => t);
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp")), "a crash's leftovers are cleared on open").toEqual([]);
  });
});

