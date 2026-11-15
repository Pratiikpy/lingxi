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
