import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { withSitting } from "../src/server";
import { createSittingStore, keyHashOf } from "../src/sitting";

const KEY = "c".repeat(32);
const pack = JSON.stringify({ v: 1, pet: { bornAt: 1 } });

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

  it("refuses junk packs, bad keys, impossible end dates, and forgets old sittings", () => {
    let t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t);
    expect(store.leave("not json", keyHashOf(KEY), t + 1000).ok).toBe(false);
    expect(store.leave(pack, "short", t + 1000).ok).toBe(false);
    expect(store.leave(pack, keyHashOf(KEY), t - 1).ok).toBe(false);
    expect(store.leave(pack, keyHashOf(KEY), t + 40 * 86_400_000).ok).toBe(false);
    const r = store.leave(pack, keyHashOf(KEY), t + 1000);
    expect(r.ok).toBe(true);
    t += 8 * 86_400_000;
    store.leave(pack, keyHashOf(KEY), t + 1000);
    expect(store.collect((r as { code: string }).code)).toBeNull();
  });
});
