/** A78: no unlimited multi-megabyte GETs. Cards kept small, the season served from one text per change, heavy reads limited. */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { canonicalCard, petCard, weekOf } from "@lingxi/game";
import { READ_LIMITS, withReadLimits } from "../src/readLimits";
import { createSeasonStore } from "../src/season";
import { createArenaStore } from "../src/arena";
import { withSeason } from "../src/server";

const T = Date.UTC(2026, 10, 18, 12);
const real = petCard({ lessons: [{ when: { event: [3] }, then: { want: 5, mood: 1 } }] } as never);
const padded = JSON.stringify({ ...(JSON.parse(real) as object), pad: "x".repeat(20_000) });
const pet = (name: string, card: string) => ({ name, line: "gentle", stage: "child", card, story: { days: 1, lessons: 1, nature: [] } });

describe("cards kept small, the season served from one text (A78)", () => {
  it("a padded card entered in the season or the arena is kept in its own shape", () => {
    const season = createSeasonStore(undefined, () => T);
    expect(season.enter(pet("Mochi", padded), "device-0001")).toMatchObject({ ok: true });
    expect(season.view(weekOf(T))!.entries[0]!.pet.card).toBe(canonicalCard(padded));
    const arena = createArenaStore(undefined, () => T);
    expect(arena.save(1, pet("Tofu", padded), [], "device-0002")).toEqual({ ok: true });
    expect(arena.pick(1, "device-0003", 0)!.pet.card).toBe(canonicalCard(padded));
  });

  it("two season reads serve the same text, and an entry changes it", async () => {
    const season = createSeasonStore(undefined, () => T);
    season.enter(pet("Mochi", real), "device-0001");
    const app = withSeason(new Hono(), season, undefined, () => T);
    const read = async () => (await app.request("/api/season/current")).text();
    const a = await read();
    expect(await read()).toBe(a);
    season.enter(pet("Tofu", real), "device-0002");
    const b = await read();
    expect(b).not.toBe(a);
    expect((JSON.parse(b) as { entries: unknown[] }).entries).toHaveLength(2);
  });
});

describe("heavy reads are limited per caller (A78)", () => {
  const paths: Array<[string, string]> = [
    ["/api/season/current", "season"],
    ["/api/pets/7/log", "diary log"],
    ["/api/duels/AAAAAAAAAAAAAAAA", "duel link"],
    ["/api/tree", "tree"],
    ["/api/v1/agents/me", "agent's pet"],
  ];
  for (const [path, what] of paths) {
    it(`the ${what} answers "busy" past its limit, and another caller is not affected`, async () => {
      const app = withReadLimits(new Hono());
      app.get(path.replace(/\/[A-Z]{16}$/, "/:id").replace(/\/7\//, "/:id/"), (c) => c.json({ ok: true }));
      const limit = READ_LIMITS.find(([re]) => re.test(path))![1];
      const get = (ip: string) => app.request(path, { headers: { "cf-connecting-ip": ip } });
      for (let i = 0; i < limit; i++) expect(((await (await get("198.51.100.1")).json()) as { ok: boolean }).ok).toBe(true);
      expect(await (await get("198.51.100.1")).json()).toEqual({ ok: false, reason: "busy" });
      expect(((await (await get("198.51.100.2")).json()) as { ok: boolean }).ok).toBe(true);
    });
  }
});
