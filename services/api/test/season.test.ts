import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { MAX_ENTRIES, petCard, seasonStandings, standingsDigest } from "@lingxi/game";
import { withSeason } from "../src/server";
import { createSeasonStore } from "../src/season";
import { PREFIX_SHARE } from "../src/limit";
import { createStandingsRunner } from "../src/standings";

const pet = (name: string, line = "gentle") => ({ name, line, stage: "child", card: petCard({ lessons: [] }), story: { days: 1, lessons: 0, nature: [] } });
const T = Date.UTC(2026, 10, 18, 12); // Wednesday of 2026-W47

describe("weekly seasons", () => {
  it("enter with one tap, update your own entry, and serve standings anyone can recompute", async () => {
    let t = T;
    const store = createSeasonStore(undefined, () => t);
    const app = withSeason(new Hono(), store, undefined, () => t);
    const enter = (body: unknown) => app.request("/api/season/enter", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    const a = await (await enter({ pet: pet("Ana"), device: "device-aaaa-1111" })).json();
    expect(a).toMatchObject({ ok: true, week: "2026-W47" });
    await enter({ pet: pet("Bea", "bold"), device: "device-bbbb-2222" });
    const again = await (await enter({ pet: pet("Ana2", "curious"), device: "device-aaaa-1111" })).json();
    expect(again.key).toBe(a.key);
    const v = await (await app.request("/api/season/current")).json();
    expect(v.week).toBe("2026-W47");
    expect(v.closed).toBe(false);
    expect(v.entries.map((e: { pet: { name: string } }) => e.pet.name).sort()).toEqual(["Ana2", "Bea"]);
    expect(standingsDigest(seasonStandings(v.week, v.entries))).toBe(v.digest);
    t += 7 * 86_400_000;
    const closed = await (await app.request("/api/season/2026-W47")).json();
    expect(closed.closed).toBe(true);
    expect((await (await app.request("/api/season/current")).json()).week).toBe("2026-W48");
  });

  it("refuse junk, cap the week, and reject bad week names", async () => {
    const store = createSeasonStore(undefined, () => T);
    expect(store.enter({ ...pet("X"), card: "{nope" }, "device-cccc-3333")).toEqual({ ok: false, reason: "invalid" });
    expect(store.enter(pet("X"), "short")).toEqual({ ok: false, reason: "invalid" });
    for (let i = 0; i < MAX_ENTRIES; i++) expect(store.enter(pet(`P${i}`), `device-${String(i).padStart(8, "0")}`).ok).toBe(true);
    expect(store.enter(pet("Late"), "device-late-9999")).toEqual({ ok: false, reason: "full" });
    expect(store.enter(pet("P0 again"), "device-00000000").ok).toBe(true);
    const app = withSeason(new Hono(), store, undefined, () => T);
    expect((await app.request("/api/season/../../etc")).status).toBe(404);
    expect((await app.request("/api/season/2026-47")).status).toBe(400);
  });
});

describe("no one fills the season", () => {
  it("one IPv6 /48 holds four addresses' worth of entries, and another player still gets in (A117)", () => {
    const store = createSeasonStore(undefined, () => T);
    const results: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = store.enter(pet(`Net${i}`), `device-net-${String(i).padStart(4, "0")}`, { from: `2001:db8:117:${(Math.floor(i / 2) + 1).toString(16)}::/64` });
      results.push(r.ok ? "ok" : r.reason);
    }
    expect(results.filter((x) => x === "ok").length).toBe(3 * PREFIX_SHARE);
    expect(results.at(-1)).toBe("tooMany");
    expect(store.enter(pet("Honest"), "device-honest-01", { from: "198.51.100.17" }).ok).toBe(true);
  });

  it("one address holds only a few entries a week, and updating its own costs nothing", () => {
    const store = createSeasonStore(undefined, () => T);
    for (let i = 0; i < 3; i++) expect(store.enter(pet(`Mine${i}`), `device-mine-000${i}`, { from: "203.0.113.9" }).ok).toBe(true);
    expect(store.enter(pet("Mine3"), "device-mine-0003", { from: "203.0.113.9" })).toEqual({ ok: false, reason: "tooMany" });
    expect(store.enter(pet("Mine0 again"), "device-mine-0000", { from: "203.0.113.9" }).ok).toBe(true);
    expect(store.enter(pet("Yours"), "device-your-0000", { from: "198.51.100.1" }).ok).toBe(true);
  });

  it("a proven pet has one entry: entering it from another device moves it there", () => {
    const store = createSeasonStore(undefined, () => T);
    store.enter(pet("Ana"), "device-aaaa-1111", { petId: "7" });
    store.enter(pet("Ana on her phone"), "device-aaaa-2222", { petId: "7" });
    const v = store.view("2026-W47")!;
    expect(v.entries.map((e) => e.pet.name)).toEqual(["Ana on her phone"]);
  });
});

describe("champion keepsakes", () => {
  it("go to the best-placed proven pet once; a failure is retried, then given up; nothing private is served", async () => {
    let t = T;
    const store = createSeasonStore(undefined, () => t);
    store.enter(pet("Ana"), "device-aaaa-1111", { petId: "11" });
    store.enter(pet("Bea", "bold"), "device-bbbb-2222", { petId: "22" });
    const { settleAwards } = await import("../src/season");
    const calls: string[] = [];
    let fail = true;
    const give = async (_e: unknown, petId: string) => {
      calls.push(petId);
      return fail ? { ok: false as const, detail: "rpc down" } : { ok: true as const, brainId: "77", to: "0x2222222222222222222222222222222222222222", tapeTx: "0xaa", sendTx: "0xbb" };
    };
    await settleAwards(store, give);
    expect(calls).toHaveLength(0); // the week is still open
    t += 7 * 86_400_000;
    await settleAwards(store, give);
    await settleAwards(store, give);
    expect(calls).toHaveLength(2);
    expect(store.view("2026-W47")!.award).toBeUndefined();
    fail = false;
    await settleAwards(store, give);
    await settleAwards(store, give);
    expect(calls).toHaveLength(3);
    const v = store.view("2026-W47")!;
    expect(v.award).toMatchObject({ brainId: "77", sendTx: "0xbb", key: v.standings[0]!.key });
    expect(JSON.stringify(v)).not.toMatch(/"pets"|"from"|203\.0\.113/);
  });

  it("with standings fought off the request thread, a view says pending until they are fought, and no keepsake is chosen from them (A38)", async () => {
    let t = T;
    const go: Array<() => void> = [];
    const runner = createStandingsRunner({ compute: (week, entries) => new Promise((r) => go.push(() => r(seasonStandings(week, entries)))) });
    const store = createSeasonStore(undefined, () => t, runner);
    store.enter(pet("Ana"), "device-aaaa-1111", { petId: "11" });
    store.enter(pet("Bea", "bold"), "device-bbbb-2222", { petId: "22" });
    expect(store.view("2026-W47")).toMatchObject({ standings: [], pending: true });
    t += 7 * 86_400_000;
    expect(store.pending(), "no champion from standings still being fought").toEqual([]);
    go.splice(0).forEach((f) => f());
    await runner.idle();
    const v = store.view("2026-W47")!;
    expect(v.pending).toBeUndefined();
    expect(v.standings).toEqual(seasonStandings("2026-W47", v.entries));
    expect(store.pending().map((p) => p.petId)).toHaveLength(1);
  });

  it("skip an unproven champion for the best proven pet below it", async () => {
    let t = T;
    const store = createSeasonStore(undefined, () => t);
    for (let i = 0; i < 6; i++) store.enter(pet(`Pet${i}`, ["gentle", "bold", "curious"][i % 3]), `device-pet0000${i}`, i === 5 ? { petId: "55" } : {});
    t += 7 * 86_400_000;
    const { settleAwards } = await import("../src/season");
    const given: string[] = [];
    await settleAwards(store, async (_e, petId) => {
      given.push(petId);
      return { ok: true as const, brainId: "1", to: "0x5", tapeTx: "", sendTx: "" };
    });
    expect(given).toEqual(["55"]);
  });

  it("a week with no proven pet gets a record but no keepsake", async () => {
    let t = T;
    const store = createSeasonStore(undefined, () => t);
    store.enter(pet("Solo"), "device-solo-0000");
    t += 7 * 86_400_000;
    const { settleAwards } = await import("../src/season");
    await settleAwards(store, async () => ({ ok: true as const, brainId: "1", to: "0x1", tapeTx: "", sendTx: "" }));
    expect(store.view("2026-W47")!.award).toMatchObject({ name: "Solo", none: "noWallet" });
    expect(store.enter(pet("Bad"), "device-bad-00000", { petId: "not-a-pet" })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("POST /api/season/enter with a proof", () => {
  const post = (app: Hono, body: unknown) => app.request("/api/season/enter", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" } });
  it("enters a proven pet as that pet, refuses a proof that fails, and never enters it unproven instead", async () => {
    const store = createSeasonStore(undefined, () => T);
    let verdict: { ok: true; petId: string } | { ok: false; reason: string } = { ok: false, reason: "notItsBrain" };
    const app = withSeason(new Hono(), store, undefined, () => T, async () => verdict);
    const refused = await post(app, { pet: pet("Ana"), device: "device-aaaa-1111", proof: {} });
    expect(refused.status).toBe(200);
    expect(await refused.json()).toMatchObject({ ok: false, reason: "notProven", detail: "notItsBrain" });
    expect(store.view("2026-W47")!.entries).toHaveLength(0);
    verdict = { ok: true, petId: "7" };
    const ok = await post(app, { pet: pet("Ana"), device: "device-aaaa-1111", proof: {} });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, proven: true });
    expect(store.pending()).toEqual([]);
    // an entry without a proof is told it is not proven
    expect(await (await post(app, { pet: pet("Bea"), device: "device-bbbb-2222" })).json()).toMatchObject({ ok: true, proven: false });
  });

  it("says plainly when the server cannot check pets on chain", async () => {
    const app = withSeason(new Hono(), createSeasonStore(undefined, () => T), undefined, () => T);
    expect((await post(app, { pet: pet("Ana"), device: "device-aaaa-1111", proof: {} })).status).toBe(503);
  });
});
