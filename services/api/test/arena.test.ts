import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { petCard } from "@lingxi/game";
import { withArena } from "../src/server";
import { createArenaStore, validSnapshot } from "../src/arena";

const pet = { name: "Mochi", line: "gentle", stage: "child", card: petCard({ lessons: [] }), story: { days: 3, lessons: 0, nature: [] } };
const A = "device-aaaa-1111";
const B = "device-bbbb-2222";

describe("arena snapshots", () => {
  it("serve another player's line at the same round, never your own", async () => {
    const app = withArena(new Hono(), createArenaStore());
    const post = (body: unknown) => app.request("/api/arena/snapshot", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    expect(await (await post({ round: 2, pet, team: ["bolt", "sprig"], device: A })).json()).toEqual({ ok: true });
    expect(await (await app.request(`/api/arena/opponent?round=2&device=${A}`)).json()).toEqual({ ok: false, reason: "none" });
    const got = await (await app.request(`/api/arena/opponent?round=2&device=${B}`)).json();
    expect(got.ok).toBe(true);
    expect(got.team).toEqual(["bolt", "sprig"]);
    expect(got.pet.name).toBe("Mochi");
    expect(got.by).toBeUndefined();
    expect(await (await app.request(`/api/arena/opponent?round=3&device=${B}`)).json()).toEqual({ ok: false, reason: "none" });
  });

  it("keep one line per device per round", () => {
    const store = createArenaStore();
    store.save(1, pet, ["bolt"], A);
    store.save(1, pet, ["shell"], A);
    expect(store.count(1)).toBe(1);
    expect(store.pick(1, B)!.team).toEqual(["shell"]);
  });

  it("refuse lines no run could field and pets whose mind is damaged", async () => {
    expect(validSnapshot(pet, ["bolt", "bolt", "bolt", "bolt", "bolt"])).toBeNull();
    expect(validSnapshot(pet, ["dragon"])).toBeNull();
    expect(validSnapshot({ ...pet, line: "evil" }, [])).toBeNull();
    expect(validSnapshot({ ...pet, card: "{not json" }, [])).toBeNull();
    expect(validSnapshot({ ...pet, name: "" }, [])).toBeNull();
    expect(validSnapshot(pet, [])).not.toBeNull();
    const app = withArena(new Hono(), createArenaStore());
    const r = await app.request("/api/arena/snapshot", { method: "POST", body: JSON.stringify({ round: 99, pet, team: [], device: A }), headers: { "content-type": "application/json" } });
    expect(r.status).toBe(400);
    expect((await app.request("/api/arena/opponent?round=x&device=short")).status).toBe(400);
  });
});

describe("one sender cannot take over a round, and names are shown clean (A144)", () => {
  it("an address holds two lines a round and a /48 eight; a full round makes room from the most crowded sender", () => {
    const store = createArenaStore();
    const got: boolean[] = [];
    for (let i = 0; i < 60; i++) got.push(store.save(4, pet, [], `device-flood-${String(i).padStart(4, "0")}`, "198.51.100.44").ok);
    expect(got.filter(Boolean).length, "two lines from one address").toBe(2);
    let net = 0;
    for (let i = 0; i < 40; i++) if (store.save(4, pet, [], `device-net-${String(i).padStart(4, "0")}`, `2001:db8:144:${i.toString(16)}::/64`).ok) net++;
    expect(net, "eight from one /48").toBe(8);
    // fill the round from many addresses, then one more still gets in, in place of the most crowded sender's line
    for (let i = 0; i < 60; i++) store.save(4, { ...pet, name: `Many${i}` }, [], `device-many-${String(i).padStart(4, "0")}`, `203.0.${Math.floor(i / 2)}.${i % 2}`);
    expect(store.count(4)).toBe(60);
    expect(store.save(4, pet, [], "device-late-0001", "192.0.2.1").ok).toBe(true);
    // a player picked against in that round meets lines from many senders, not one
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(store.pick(4, "device-reader-01", i / 200)!.pet.name);
    expect(seen.size).toBeGreaterThan(20);
  });

  it("a name with direction overrides, invisible characters or blocked words is shown clean", () => {
    const store = createArenaStore();
    store.save(5, { ...pet, name: "\u202eLingxi\u200d Team\u200b" }, [], "device-name-0001", "198.51.100.50");
    const shown = store.pick(5, "device-other-001", 0)!.pet.name;
    expect(shown).not.toMatch(/\u202e|\u200d|\u200b/);
    store.save(6, { ...pet, name: "fuckface" }, [], "device-name-0002", "198.51.100.51");
    expect(store.pick(6, "device-other-001", 0)!.pet.name).toBe("Pet");
  });
});
