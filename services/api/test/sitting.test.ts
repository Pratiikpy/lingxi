import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { withSitting } from "../src/server";
import { MAX_PACKS, MAX_PACKS_PER_OWNER, createSittingStore, keyHashOf } from "../src/sitting";
import { PREFIX_SHARE } from "../src/limit";

const KEY = "c".repeat(32);
const pack = JSON.stringify({ v: 1, pet: { bornAt: 1 } });
const big = (n: number) => JSON.stringify({ v: 1, pet: { bornAt: 1 }, pad: "x".repeat(n) });

describe("pet-sitting packs", () => {
  it("leaves, collects and sends home only with the right key", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t);
    const app = withSitting(new Hono(), store);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
    const left = await (await post("/api/sit", { pack, keyHash: keyHashOf(KEY), until: t + 86_400_000 })).json();
    expect(left.ok).toBe(true);
    const got = await (await app.request(`/api/sit/${left.code}`)).json();
    expect(got).toEqual({ ok: true, pack });
    expect(await (await post(`/api/sit/${left.code}/home`, { key: "d".repeat(32), pet: "{}" })).json()).toEqual({
      ok: false,
      reason: "refused",
    });
    expect(await (await post(`/api/sit/${left.code}/home`, { key: KEY, pet: '{"back":1}' })).json()).toEqual({
      ok: true,
    });
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
    const store = createSittingStore(undefined, () => t, { maxBytes: 1_000_000, perOwner: 3, freeShare: 1 });
    for (let i = 0; i < 3; i++)
      expect((await store.leave(pack, keyHashOf(KEY), t + 1000, "203.0.113.9")).ok).toBe(true);
    expect(await store.leave(pack, keyHashOf(KEY), t + 1000, "203.0.113.9")).toEqual({ ok: false, reason: "tooMany" });
    expect((await store.leave(pack, keyHashOf(KEY), t + 1000, "198.51.100.1")).ok).toBe(true);
    // a bigger pack than the budget has left is refused, whoever sends it
    expect((await store.leave(big(500_000), keyHashOf(KEY), t + 1000, "198.51.100.2")).ok).toBe(true);
    expect(await store.leave(big(500_000), keyHashOf(KEY), t + 1000, "198.51.100.3")).toEqual({
      ok: false,
      reason: "full",
    });
    expect(store.stats().bytes).toBeLessThanOrEqual(1_000_000);
  });

  it("one IPv6 /48 holds four addresses' worth of packs and its share of the bytes, and another player still leaves one (A118)", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t, {
      maxBytes: 10_000_000,
      perOwner: 3,
      perNetworkBytes: 1_000_000,
      freeShare: 1,
    });
    const net = (i: number) => `2001:db8:118:${(i + 1).toString(16)}::/64`;
    const got: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await store.leave(pack, keyHashOf(KEY), t + 1000, net(i));
      got.push(r.ok ? "ok" : r.reason);
    }
    expect(got.filter((x) => x === "ok").length).toBe(3 * PREFIX_SHARE);
    expect(got.at(-1)).toBe("tooMany");
    expect((await store.leave(pack, keyHashOf(KEY), t + 1000, "198.51.100.18")).ok).toBe(true);
    // in bytes too: a big pack from another /64 of a /48 that already holds its share is refused
    const bytes = createSittingStore(undefined, () => t, {
      maxBytes: 10_000_000,
      perOwner: 8,
      perNetworkBytes: 1_000_000,
      freeShare: 1,
    });
    expect((await bytes.leave(big(450_000), keyHashOf(KEY), t + 1000, "2001:db8:119:1::/64")).ok).toBe(true);
    expect((await bytes.leave(big(450_000), keyHashOf(KEY), t + 1000, "2001:db8:119:2::/64")).ok).toBe(true);
    expect(await bytes.leave(big(450_000), keyHashOf(KEY), t + 1000, "2001:db8:119:3::/64")).toEqual({
      ok: false,
      reason: "tooMany",
    });
    expect((await bytes.leave(big(450_000), keyHashOf(KEY), t + 1000, "198.51.100.19")).ok).toBe(true);
  });

  it("a homecoming counts against the pack owner's network share, so tiny packs sent home large cannot pass it (A146)", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t, {
      maxBytes: 100_000_000,
      perOwner: 8,
      perNetworkBytes: 1_000_000,
      freeShare: 1,
    });
    const codes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await store.leave(pack, keyHashOf(KEY), t + 1000, `2001:db8:146:${(i % 4).toString(16)}::/64`);
      if (r.ok) codes.push(r.code);
    }
    let home = 0;
    for (const code of codes) if (await store.sendHome(code, KEY, big(200_000))) home++;
    expect(home, "homecomings stop at the network's million bytes").toBeLessThanOrEqual(5);
    // a pack from another network is not held up
    const other = await store.leave(pack, keyHashOf(KEY), t + 1000, "198.51.100.146");
    expect(other.ok && (await store.sendHome(other.code, KEY, big(200_000)))).toBe(true);
  });

  it("many networks leaving large packs still leave room for an honest pack (A141)", async () => {
    const t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t, {
      maxBytes: 8_000_000,
      perOwner: 8,
      perNetworkBytes: 500_000,
    });
    // each network leaves large packs, then tops off with smaller ones, as one filling the shelf would
    for (let net = 0; net < 40; net++)
      for (const size of [90_000, 10_000, 1_000])
        for (let i = 0; i < 12; i++)
          await store.leave(
            big(size),
            keyHashOf(KEY),
            t + 1000,
            `2001:db8:${(0x1500 + net).toString(16)}:${i.toString(16)}::/64`,
          );
    expect(
      (await store.leave(big(20_000), keyHashOf(KEY), t + 1000, "203.0.113.142")).ok,
      "a 20 KB pack from someone new",
    ).toBe(true);
  });

  it("counts every pack an address still has on the shelf, past its end date too, until it is let go (A50)", async () => {
    let t = 1_800_000_000_000;
    const store = createSittingStore(undefined, () => t, { maxBytes: 1_000_000, perOwner: 3, freeShare: 1 });
    // sittings a minute long, sent one after another
    for (let i = 0; i < 3; i++)
      expect((await store.leave(pack, keyHashOf(KEY), t + 60_000, "203.0.113.9")).ok).toBe(true);
    t += 2 * 60_000;
    expect(
      await store.leave(pack, keyHashOf(KEY), t + 60_000, "203.0.113.9"),
      "past their end, still kept, still counted",
    ).toEqual({ ok: false, reason: "tooMany" });
    // a week after they ended they are let go, and count no more
    t += 7 * 86_400_000;
    expect((await store.leave(pack, keyHashOf(KEY), t + 60_000, "203.0.113.9")).ok).toBe(true);
  });

  it("keeps each pack in its own file and remembers them all after a restart", async () => {
    const t = 1_800_000_000_000;
    const dir = join(mkdtempSync(join(tmpdir(), "lx-sit-")), "sitting");
    const a = createSittingStore(dir, () => t);
    const r = (await a.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.9")) as { code: string };
    expect(readdirSync(dir).sort()).toEqual([`${r.code}.meta`, `${r.code}.pack`]);
    const b = createSittingStore(dir, () => t);
    expect(await b.collect(r.code)).toEqual({ pack });
  });

  it("moves a store from before (one JSON file) into the new layout without losing a pack", async () => {
    const t = 1_800_000_000_000;
    const base = mkdtempSync(join(tmpdir(), "lx-sit-"));
    const legacy = join(base, "sitting.json");
    const code = "a".repeat(24);
    writeFileSync(
      legacy,
      JSON.stringify({
        [code]: { pack, keyHash: keyHashOf(KEY), until: t + 86_400_000, created: t, back: '{"home":1}', backAt: t },
      }),
    );
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
    const store = createSittingStore(mkdtempSync(join(tmpdir(), "sit-")), () => t, {
      maxBytes: 100_000_000,
      perOwner: 8,
    });
    const got = await Promise.all(
      Array.from({ length: 30 }, () => store.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.76")),
    );
    expect(got.filter((r) => r.ok)).toHaveLength(8);
    expect(got.filter((r) => !r.ok && r.reason === "tooMany")).toHaveLength(22);
    expect(store.stats().packs).toBe(8);
  });

  it("thirty addresses at once keep to the byte budget, and a pack sent home keeps to it too", async () => {
    const t = 1_800_000_000_000;
    const size = big(1_000).length;
    const store = createSittingStore(mkdtempSync(join(tmpdir(), "sit-")), () => t, {
      maxBytes: size * 5,
      perOwner: 8,
      freeShare: 1,
    });
    const got = await Promise.all(
      Array.from({ length: 30 }, (_, i) => store.leave(big(1_000), keyHashOf(KEY), t + 86_400_000, `198.51.100.${i}`)),
    );
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
    const store = createSittingStore(mkdtempSync(join(tmpdir(), "sit-")), () => t, {
      maxBytes: 100_000_000,
      perOwner: 8,
    });
    const left = await store.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.77");
    if (!left.ok) throw new Error("not left");
    const before = store.stats().bytes;
    await Promise.all([store.sendHome(left.code, KEY, big(500)), store.sendHome(left.code, KEY, big(500))]);
    expect(store.stats().bytes).toBe(before + big(500).length);
  });

  it("twenty pets sent home to one code at once never collide on a file, and stray temporary files are cleared (A98)", async () => {
    const t = 1_800_000_000_000;
    const dir = mkdtempSync(join(tmpdir(), "sit-"));
    const store = createSittingStore(dir, () => t, { maxBytes: 100_000_000, perOwner: 8, freeShare: 1 });
    const left = await store.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.98");
    if (!left.ok) throw new Error("not left");
    const before = store.stats().bytes;
    const sent = await Promise.allSettled(Array.from({ length: 20 }, () => store.sendHome(left.code, KEY, big(300))));
    expect(
      sent.filter((r) => r.status === "rejected"),
      "no write failed",
    ).toEqual([]);
    expect(store.stats().bytes).toBe(before + big(300).length);
    expect(
      readdirSync(dir).filter((f) => f.endsWith(".tmp")),
      "nothing left half-written",
    ).toEqual([]);
    writeFileSync(join(dir, `${left.code}.back.abc.tmp`), "half");
    createSittingStore(dir, () => t);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      readdirSync(dir).filter((f) => f.endsWith(".tmp")),
      "a crash's leftovers are cleared on open",
    ).toEqual([]);
  });
});

describe("the shelf holds a bounded number of packs, and each pack's facts in a file of its own (P10)", () => {
  const t = 1_800_000_000_000;
  const v4 = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

  it("holds at most MAX_PACKS packs, its last places going to whoever comes new", { timeout: 60_000 }, async () => {
    const store = createSittingStore(undefined, () => t);
    let refused = 0;
    for (let a = 0; store.stats().packs < MAX_PACKS && a < 4_000; a++)
      for (let k = 0; k < MAX_PACKS_PER_OWNER; k++)
        if (!(await store.leave(pack, keyHashOf(KEY), t + 86_400_000, v4(a))).ok) refused++;
    expect(store.stats().packs).toBe(MAX_PACKS);
    // near the end an address may take fewer than its eight: the places it may take shrink as the shelf fills
    expect(refused).toBeGreaterThan(0);
    expect(await store.leave(pack, keyHashOf(KEY), t + 86_400_000, "198.51.100.200")).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("the places a network may take shrink as the shelf fills, so sixty networks leave room for an honest pack", async () => {
    const limits = { maxBytes: 10_000_000, perOwner: 8, maxPacks: 400 };
    const store = createSittingStore(undefined, () => t, limits);
    const took: number[] = [];
    for (let n = 0; n < 60; n++) {
      let ok = 0;
      for (let s = 0; s < 8; s++)
        for (let k = 0; k < 8; k++)
          if ((await store.leave(pack, keyHashOf(KEY), t + 86_400_000, `2001:db8:${n.toString(16)}:${s}::/64`)).ok)
            ok++;
      took.push(ok);
    }
    // the first network: a sixteenth of the 400 places, under its cap of 8 x PREFIX_SHARE
    expect(took[0]).toBe(25);
    expect(store.stats().packs).toBeLessThan(400);
    expect((await store.leave(pack, keyHashOf(KEY), t + 86_400_000, "198.51.100.7")).ok).toBe(true);
  });

  it("keeps each pack's facts in a small file of its own, never one index of every pack, across a restart", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "lx-sit-")), "sitting");
    const a = createSittingStore(dir, () => t);
    const one = (await a.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.9")) as { code: string };
    const two = (await a.leave(big(50), keyHashOf(KEY), t + 86_400_000, "203.0.113.10")) as { code: string };
    expect(await a.sendHome(two.code, KEY, '{"home":2}')).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(
      [`${one.code}.meta`, `${one.code}.pack`, `${two.code}.back`, `${two.code}.meta`, `${two.code}.pack`].sort(),
    );
    const b = createSittingStore(dir, () => t);
    expect(b.stats()).toEqual(a.stats());
    expect(await b.collect(one.code)).toEqual({ pack });
    expect(await b.collect(two.code)).toEqual({ pack: big(50), back: '{"home":2}', backAt: t });
    // a pack a crash left without its facts was never handed out: it goes at a start
    writeFileSync(join(dir, `${"e".repeat(24)}.pack`), pack);
    createSittingStore(dir, () => t);
    expect(existsSync(join(dir, `${"e".repeat(24)}.pack`))).toBe(false);
  });

  it("moves a store kept with one index into a file of facts a pack, and lets the index go", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "lx-sit-")), "sitting");
    const a = createSittingStore(dir, () => t);
    const one = (await a.leave(pack, keyHashOf(KEY), t + 86_400_000, "203.0.113.9")) as { code: string };
    const metas = readdirSync(dir).filter((n) => n.endsWith(".meta"));
    const index = Object.fromEntries(
      metas.map((n) => [n.slice(0, -".meta".length), JSON.parse(readFileSync(join(dir, n), "utf8")) as unknown]),
    );
    for (const n of metas) rmSync(join(dir, n));
    writeFileSync(join(dir, "index.json"), JSON.stringify(index));
    writeFileSync(join(dir, "index.json.bak"), JSON.stringify(index));
    const b = createSittingStore(dir, () => t);
    expect(await b.collect(one.code)).toEqual({ pack });
    expect(readdirSync(dir).sort()).toEqual([`${one.code}.meta`, `${one.code}.pack`]);
    expect(createSittingStore(dir, () => t).stats()).toEqual(a.stats());
  });
});

describe("a sitting index that cannot be read takes no pack with it (P10)", () => {
  it("keeps every pack on disk when the index and its .bak are damaged, at this start and the next", async () => {
    const t = 1_800_000_000_000;
    const dir = join(mkdtempSync(join(tmpdir(), "lx-sit-")), "sitting");
    const a = createSittingStore(dir, () => t);
    for (let i = 0; i < 3; i++) await a.leave(pack, keyHashOf(KEY), t + 86_400_000, `203.0.113.${i}`);
    // the layout before P10: an index, no facts beside the packs; and both copies of the index damaged
    for (const n of readdirSync(dir).filter((x) => x.endsWith(".meta"))) rmSync(join(dir, n));
    writeFileSync(join(dir, "index.json"), "{cut sho");
    writeFileSync(join(dir, "index.json.bak"), "{cut");
    const said: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((text) => {
      said.push(String(text));
      return true;
    });
    try {
      createSittingStore(dir, () => t);
      createSittingStore(dir, () => t);
    } finally {
      spy.mockRestore();
    }
    expect(readdirSync(dir).filter((x) => x.endsWith(".pack"))).toHaveLength(3);
    expect(said.join("")).toMatch(/kept aside/);
  });
  it("keeps a pack the index's .bak, one write behind, does not list, when the index itself could not be read", async () => {
    const t = 1_800_000_000_000;
    const dir = join(mkdtempSync(join(tmpdir(), "lx-sit-")), "sitting");
    const a = createSittingStore(dir, () => t);
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await a.leave(pack, keyHashOf(KEY), t + 86_400_000, `203.0.113.${i}`);
      if (r.ok) codes.push(r.code);
    }
    const facts = Object.fromEntries(
      codes.map((c) => [c, JSON.parse(readFileSync(join(dir, `${c}.meta`), "utf8")) as unknown]),
    );
    for (const c of codes) rmSync(join(dir, `${c}.meta`));
    writeFileSync(join(dir, "index.json"), "{cut sho");
    // the .bak as the write before the last left it: the third pack not yet in it
    writeFileSync(join(dir, "index.json.bak"), JSON.stringify(Object.fromEntries(Object.entries(facts).slice(0, 2))));
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const b = createSittingStore(dir, () => t);
      expect(await b.collect(codes[0] ?? "")).toEqual({ pack });
    } finally {
      spy.mockRestore();
    }
    expect(readdirSync(dir).filter((x) => x.endsWith(".pack"))).toHaveLength(3);
  });
});
