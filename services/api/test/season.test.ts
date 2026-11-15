import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { MAX_ENTRIES, petCard, seasonStandings, standingsDigest } from "@lingxi/game";
import { withSeason } from "../src/server";
import { createSeasonStore } from "../src/season";

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

describe("champion keepsakes", () => {
  it("go to a finished week's champion once; no wallet means none; a failure is retried, then given up", async () => {
    let t = Date.UTC(2026, 10, 18, 12);
    const store = createSeasonStore(undefined, () => t);
    store.enter(pet("Ana"), "device-aaaa-1111", "0x1111111111111111111111111111111111111111");
    store.enter(pet("Bea", "bold"), "device-bbbb-2222", "0x2222222222222222222222222222222222222222");
    const { settleAwards } = await import("../src/season");
    const calls: string[] = [];
    let fail = true;
    const give = async (_e: unknown, wallet: string) => {
      calls.push(wallet);
      return fail ? { ok: false as const, detail: "rpc down" } : { ok: true as const, brainId: "77", tapeTx: "0xaa", sendTx: "0xbb" };
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
    expect(JSON.stringify(v)).not.toContain("wallets");
    expect(v.entries.some((e) => JSON.stringify(e).includes("0x2222"))).toBe(false);
  });

  it("a champion entered without a wallet gets a record but no keepsake", async () => {
    let t = Date.UTC(2026, 10, 18, 12);
    const store = createSeasonStore(undefined, () => t);
    store.enter(pet("Solo"), "device-solo-0000");
    t += 7 * 86_400_000;
    const { settleAwards } = await import("../src/season");
    await settleAwards(store, async () => ({ ok: true as const, brainId: "1", tapeTx: "", sendTx: "" }));
    expect(store.view("2026-W47")!.award).toMatchObject({ name: "Solo", none: "noWallet" });
    expect(store.enter(pet("Bad"), "device-bad-00000", "not-a-wallet")).toEqual({ ok: false, reason: "invalid" });
  });
});
