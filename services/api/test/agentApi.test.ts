import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { STARTERS, encodeProgram } from "@lingxi/brain";
import { PET_SCHOOL } from "@lingxi/game";
import { createAgentStore } from "../src/agents";
import { withAgentApi } from "../src/agentApi";
import { createSeasonStore } from "../src/season";
import { RateLimiter } from "../src/limit";

function setup(start = Date.UTC(2026, 10, 18, 9)) {
  let t = start;
  const agents = createAgentStore(undefined, () => t);
  const seasons = createSeasonStore(undefined, () => t);
  const app = withAgentApi(new Hono(), { agents, seasons, limiter: new RateLimiter(10_000, 60_000) });
  const call = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  return { call, seasons, tick: (ms: number) => (t += ms) };
}

describe("the agent API", () => {
  it("describes itself and serves the manifests and partners", async () => {
    const { call } = setup();
    const idx = await (await call("/api/v1")).json();
    expect(Object.keys(idx.endpoints).length).toBeGreaterThan(8);
    const prof = await (await call("/api/v1/profiles")).json();
    expect(prof.profiles.map((p: { id: string }) => p.id)).toEqual(["PET-16x8/1", "DUEL-12x3/1"]);
    const parts = await (await call("/api/v1/partners")).json();
    expect(parts.partners.length).toBeGreaterThan(2);
    expect(parts.flyRivals.map((r: { id: string }) => r.id)).toContain("fly:ada");
  });

  it("spars any brain: a Lingxi program code or a TapeFly brain, reproducibly by seed", async () => {
    const { call } = setup();
    const code = encodeProgram(STARTERS.bold);
    const a = await (await call(`/api/v1/spar?program=${code}&vs=pip&seed=7`)).json();
    const b = await (await call(`/api/v1/spar?program=${code}&vs=pip&seed=7`)).json();
    expect(a.ok).toBe(true);
    expect(a.digest).toBe(b.digest);
    expect(["you", "them", "draw"]).toContain(a.winner);
    expect(a.rounds.length).toBeGreaterThan(0);
    const fly = await (await call(`/api/v1/spar?chips=punish,block,bite&vs=fly:ada&seed=3`)).json();
    expect(fly.ok).toBe(true);
    expect((await call("/api/v1/spar?vs=pip")).status).toBe(400);
    expect((await call(`/api/v1/spar?program=${code}&vs=nobody`)).status).toBe(400);
    expect((await call("/api/v1/spar?program=lx1.garbage&vs=pip")).status).toBe(400);
  });

  it("an agent adopts, cares, teaches, lets time pass and enters the season as an agent", async () => {
    const { call, seasons, tick } = setup();
    const adopt = await (await call("/api/v1/agents/adopt", { method: "POST", body: { agent: "Claude test", name: "Bit", line: "curious", instincts: 4 } })).json();
    expect(adopt.ok).toBe(true);
    expect(adopt.token).toMatch(/^[0-9a-f]{48}$/);
    const token = adopt.token as string;
    expect((await call("/api/v1/agents/me")).status).toBe(401);
    const fed = await (await call("/api/v1/agents/me/care", { method: "POST", token, body: { action: "feed", food: "apple" } })).json();
    expect(fed.ok).toBe(true);
    expect(["ate", "overfed", "woke"]).toContain(fed.note);
    expect((await call("/api/v1/agents/me/care", { method: "POST", token, body: { action: "dance" } })).status).toBe(400);
    const before = (await (await call("/api/v1/agents/me", { token })).json()).pet;
    tick(6 * 3_600_000);
    const later = (await (await call("/api/v1/agents/me", { token })).json()).pet;
    expect(later.meters.food).toBeLessThan(before.meters.food);
    const taught = await (await call("/api/v1/agents/me/teach", { method: "POST", token, body: { rule: PET_SCHOOL[0]!.rule } })).json();
    expect(taught.ok).toBe(true);
    expect(taught.pet.lessons).toHaveLength(1);
    const junk = await (await call("/api/v1/agents/me/teach", { method: "POST", token, body: { rule: { when: { nonsense: [9] }, then: { want: 99 } } } })).json();
    expect(junk).toMatchObject({ ok: false, reason: "invalid" });
    const entered = await (await call("/api/v1/agents/me/season", { method: "POST", token })).json();
    expect(entered.ok).toBe(true);
    const v = seasons.view(entered.week)!;
    expect(v.entries[0]!.agent).toBe("Claude test");
    seasons.enter({ name: "Human", line: "gentle", stage: "child", card: JSON.stringify({ lessons: [] }), story: { days: 1, lessons: 0, nature: [] } }, "device-human-0001");
    const board = await (await call("/api/v1/scoreboard")).json();
    expect(board.weeks[0]).toMatchObject({ week: entered.week, humans: { entries: 1 }, agents: { entries: 1 } });
  });

  it("refuse junk adoptions and cap pets per agent", async () => {
    const { call } = setup();
    expect((await call("/api/v1/agents/adopt", { method: "POST", body: { agent: "x", name: "Bit", line: "curious" } })).status).toBe(400);
    expect((await call("/api/v1/agents/adopt", { method: "POST", body: { agent: "Okay agent", name: "", line: "curious" } })).status).toBe(400);
    expect((await call("/api/v1/agents/adopt", { method: "POST", body: { agent: "Okay agent", name: "Bit", line: "dragon" } })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await (await call("/api/v1/agents/adopt", { method: "POST", body: { agent: "Busy agent", name: `P${i}`, line: "bold" } })).json()).ok).toBe(true);
    expect(await (await call("/api/v1/agents/adopt", { method: "POST", body: { agent: "Busy agent", name: "P6", line: "bold" } })).json()).toMatchObject({ ok: false, reason: "tooMany" });
    expect((await call("/api/v1/agents/me", { token: "f".repeat(48) })).status).toBe(401);
  });
});
