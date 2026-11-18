/**
 * The routes whose hand-written checks became the shared schemas (@lingxi/api-schema): each answers as it did before,
 * at the edges where a hand-written check and a schema could part, and a body that is not an object at all is refused
 * as malformed, never answered with a server error.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { withAgentApi } from "../src/agentApi";
import { createAgentStore } from "../src/agents";
import { createArenaStore } from "../src/arena";
import { withGoals } from "../src/goals";
import { createMoveStore } from "../src/move";
import { RateLimiter } from "../src/limit";
import { createPapersStore, papersMessage, withPapers } from "../src/papers";
import { createSeasonStore } from "../src/season";
import { withArena, withMove } from "../src/server";
import { withVouchers } from "../src/voucher";

const DEVICE = "d".repeat(32);
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const json = async (pending: Response | Promise<Response>) => {
  const r = await pending;
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("GET /api/arena/opponent", () => {
  const app = withArena(new Hono(), createArenaStore());
  const ask = (q: string) => json(app.request(`/api/arena/opponent?${q}`));
  it("reads the round as Number() did: an empty round is round 0, and the first of two rounds counts", async () => {
    expect(await ask(`round=&device=${DEVICE}`)).toEqual({ status: 200, body: { ok: false, reason: "none" } });
    expect(await ask(`round=2&round=x&device=${DEVICE}`)).toEqual({ status: 200, body: { ok: false, reason: "none" } });
    expect(await ask(`round=1e3&device=${DEVICE}`)).toEqual({ status: 200, body: { ok: false, reason: "none" } });
  });
  it("refuses a missing, negative or fractional round and a device outside 8-64 characters", async () => {
    for (const q of [`device=${DEVICE}`, `round=-1&device=${DEVICE}`, `round=1.5&device=${DEVICE}`, `round=Infinity&device=${DEVICE}`, "round=1", "round=1&device=1234567", `round=1&device=${"d".repeat(65)}`]) {
      expect(await ask(q), q).toEqual({ status: 400, body: { ok: false, reason: "invalid" } });
    }
  });
});

describe("GET /api/goals", () => {
  const app = withGoals(new Hono(), { entries: () => [], head: () => 0 });
  it("reads commas sent encoded as the same wallets", async () => {
    const plain = await json(app.request(`/api/goals?wallet=${ALICE},${BOB}`));
    const encoded = await json(app.request(`/api/goals?wallet=${ALICE}%2C${BOB}`));
    expect(plain.status).toBe(200);
    expect({ ...encoded.body, now: 0 }).toEqual({ ...plain.body, now: 0 });
  });
  it("answers without a wallet, and refuses a bad one as `wallet`", async () => {
    expect((await json(app.request("/api/goals"))).status).toBe(200);
    expect(await json(app.request(`/api/goals?wallet=${ALICE},0x12`))).toEqual({ status: 400, body: { ok: false, reason: "wallet" } });
  });
});

describe("GET /api/voucher", () => {
  const app = withVouchers(new Hono(), { entries: () => [], signer: owner, deployment: { chainId: 196 } });
  it("refuses a missing or bad wallet first, then an unknown or missing goal", async () => {
    expect(await json(app.request("/api/voucher?goal=g1"))).toEqual({ status: 400, body: { ok: false, reason: "wallet" } });
    expect(await json(app.request("/api/voucher?wallet=0x12&goal=g1"))).toEqual({ status: 400, body: { ok: false, reason: "wallet" } });
    expect(await json(app.request(`/api/voucher?wallet=${ALICE}&goal=nope`))).toEqual({ status: 404, body: { ok: false, reason: "goal" } });
    expect(await json(app.request(`/api/voucher?wallet=${ALICE}`))).toEqual({ status: 404, body: { ok: false, reason: "goal" } });
  });
});

describe("POST /api/papers/:petId", () => {
  const app = withPapers(new Hono(), createPapersStore(), { ownerOf: async () => owner.address as Address, sellerOf: async () => owner.address as Address });
  const post = (body: string) => json(app.request("/api/papers/7", { method: "POST", body }));
  it("answers a body that is JSON but not an object as invalid, not as a server error", async () => {
    for (const body of ["null", "5", '"papers"', "[]"]) expect(await post(body), body).toEqual({ status: 400, body: { ok: false, reason: "invalid" } });
    expect(await post("{not json")).toEqual({ status: 400, body: { ok: false, reason: "json" } });
  });
  it("still keeps papers the owner signed", async () => {
    const papers = JSON.stringify({ v: 1 });
    const signature = await owner.signMessage({ message: papersMessage("7", papers) });
    expect(await post(JSON.stringify({ papers, signature }))).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("POST /api/move", () => {
  const app = withMove(new Hono(), createMoveStore());
  const post = (body: string) => json(app.request("/api/move", { method: "POST", headers: { "content-type": "application/json" }, body }));
  it("refuses a body without a save as invalid, and takes one with a save", async () => {
    for (const body of ["null", "[]", "{}", '{"save":5}']) expect(await post(body), body).toEqual({ status: 400, body: { ok: false, reason: "invalid" } });
    const ok = await post(JSON.stringify({ save: { "lingxi.pets.v2": "[]" }, other: 1 }));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true });
  });
});

describe("POST /api/v1/agents/adopt, /me/care, /me/teach", () => {
  const app = withAgentApi(new Hono(), { agents: createAgentStore(), seasons: createSeasonStore(), limiter: new RateLimiter(10_000, 60_000) });
  const post = (path: string, body: string, token?: string) => json(app.request(path, { method: "POST", body, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } }));
  it("read a body that is JSON but not an object as an empty one, as they read any other such body", async () => {
    for (const body of ["null", "5", "[]"]) expect(await post("/api/v1/agents/adopt", body), body).toMatchObject({ status: 400, body: { ok: false, reason: "invalid" } });
    const adopted = await post("/api/v1/agents/adopt", JSON.stringify({ agent: "probe-1", name: "Bit", line: "bold" }));
    const token = adopted.body.token as string;
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    for (const body of ["null", "5", "[]"]) {
      expect(await post("/api/v1/agents/me/care", body, token), body).toEqual(await post("/api/v1/agents/me/care", "{}", token));
      expect(await post("/api/v1/agents/me/teach", body, token), body).toEqual(await post("/api/v1/agents/me/teach", "{}", token));
      expect(await post("/api/v1/agents/me/care", body, "ab".repeat(24)), body).toMatchObject({ status: 401 });
    }
    expect(await post("/api/v1/agents/me/care", "{not json", token)).toEqual({ status: 400, body: { ok: false, reason: "invalid" } });
  });
});
