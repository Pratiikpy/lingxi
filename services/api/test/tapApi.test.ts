import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARTERS, encodeProgram } from "@lingxi/brain";
import { createAgentStore } from "../src/agents";
import { withAgentApi } from "../src/agentApi";
import { withBodyLimits } from "../src/bodyLimits";
import { createSeasonStore } from "../src/season";
import { RateLimiter } from "../src/limit";
import { TAP_BODY_LIMIT, TAP_METHODS, withTapApi } from "../src/tapApi";
import { verifyEnvelope, signStatement } from "../src/tap";

// the published TAP-13 test signer and container (test values only)
const KEY = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const signer = privateKeyToAccount(KEY);
const container = "0x86DDaEF00401E3F10418398D67D7189fc458eA95" as Address;

function setup(opts: { tapLimit?: number } = {}) {
  let t = Date.UTC(2026, 10, 22, 9);
  const agents = createAgentStore(undefined, () => t);
  const seasons = createSeasonStore(undefined, () => t);
  const app = withBodyLimits(new Hono());
  withAgentApi(app, { agents, seasons, limiter: new RateLimiter(10_000, 60_000) });
  withTapApi(app, { signer, container, limiter: new RateLimiter(opts.tapLimit ?? 10_000, 60_000), now: () => Math.floor(t / 1000) });
  let n = 0;
  /** A TAP-13 call as a client makes it: returns the raw answer and the client's own view of what it sent. */
  const tap = async (method: string, params: Record<string, unknown> = {}, init: { id?: string; raw?: string; token?: string; ip?: string } = {}) => {
    const id = init.id ?? `req-${++n}`;
    const res = await app.request(`/api/v1/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.ip ? { "cf-connecting-ip": init.ip } : {}) },
      body: init.raw ?? JSON.stringify({ id, method, params }),
    });
    const text = await res.text();
    const check = (over: Partial<{ signer: Address; container: Address; id: string; method: string; params: Record<string, unknown> }> = {}) =>
      verifyEnvelope({ status: res.status, text }, { container, signer: signer.address, id, method, params, ...over }, { now: Math.floor(t / 1000) });
    return { res, text, json: () => JSON.parse(text), check, id };
  };
  const rest = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  return { tap, rest, tick: (ms: number) => (t += ms), now: () => Math.floor(t / 1000) };
}

const program = encodeProgram(STARTERS.gentle);

describe("TAP-13 answers from the agent API", () => {
  it("offers every /api/v1 operation as a method", () => {
    expect(TAP_METHODS.map((m) => m.name)).toEqual(["about", "profiles", "partners", "spar", "pet", "brain", "scoreboard", "adopt", "me", "care", "teach", "season"]);
  });

  it("signs a result that is exactly what the REST route answers", async () => {
    const { tap, rest } = setup();
    for (const [method, path] of [["about", "/api/v1"], ["profiles", "/api/v1/profiles"], ["partners", "/api/v1/partners"], ["scoreboard", "/api/v1/scoreboard"]] as const) {
      const a = await tap(method);
      expect(a.res.status).toBe(200);
      const out = await a.check();
      expect(out, method).toEqual({ kind: "accepted", ok: true, body: await (await rest(path)).json() });
      const env = a.json();
      expect(Object.keys(env).sort()).toEqual(["container", "id", "ok", "result", "sig", "ts"]);
      expect(env.container).toBe(container);
    }
  });

  it("runs a spar from params, the same fight as the GET route", async () => {
    const { tap, rest } = setup();
    const a = await tap("spar", { program, vs: "pip", seed: 7 });
    const out = await a.check();
    expect(out.kind).toBe("accepted");
    const viaRest = await (await rest(`/api/v1/spar?program=${encodeURIComponent(program)}&vs=pip&seed=7`)).json();
    expect((out as { body: unknown }).body).toEqual(viaRest);
  });

  it("raises a pet through the methods: adopt returns a token, me and care use it", async () => {
    const { tap } = setup();
    const adopt = await tap("adopt", { agent: "tap-bot", name: "Byte", line: "gentle" });
    const r = (await adopt.check()) as { kind: string; body: { ok: boolean; token: string } };
    expect(r.kind).toBe("accepted");
    expect(r.body.ok).toBe(true);
    const me = await tap("me", {}, { token: r.body.token });
    expect(((await me.check()) as { body: { pet: { name: string } } }).body.pet.name).toBe("Byte");
    const care = await tap("care", { action: "feed" }, { token: r.body.token });
    expect(((await care.check()) as { body: { ok: boolean } }).body.ok).toBe(true);
    // without the token the answer is still signed: the route's own "unknown" refusal, as a result
    const anon = (await (await tap("me")).check()) as { kind: string; body: { ok: boolean; reason: string } };
    expect(anon).toMatchObject({ kind: "accepted", body: { ok: false, reason: "unknown" } });
  });

  it("signs a malformed parameter as BAD_REQUEST, bound to the request's own id", async () => {
    const { tap } = setup();
    const a = await tap("spar", { program, vs: 12 });
    expect(a.res.status).toBe(400);
    expect(a.json().error.code).toBe("BAD_REQUEST");
    const out = await a.check();
    expect(out).toEqual({ kind: "accepted", ok: false, body: a.json().error });
    const bad = await tap("pet", { id: "1/../2" });
    expect(bad.json().error.code).toBe("BAD_REQUEST");
  });

  it("a spar with no brain is refused before the route, naming the three ways to give one (C6)", async () => {
    const { tap } = setup();
    const a = await tap("spar", { vs: "pip", seed: 7 });
    expect(a.json().error.code).toBe("BAD_REQUEST");
    expect(a.json().error.message).toBe("give exactly one brain: program (a Lingxi program code), p1 or chips (a TapeFly brain)");
    const two = await tap("spar", { program, chips: "a,b", vs: "pip" });
    expect(two.json().error.code).toBe("BAD_REQUEST");
  });

  it("the descriptors say what a caller must give and what a missing pet answers (C6)", () => {
    const spar = TAP_METHODS.find((m) => m.name === "spar")!;
    expect(spar.description).toMatch(/exactly one brain: program .*, p1 or chips/);
    const pet = TAP_METHODS.find((m) => m.name === "pet")!;
    expect(pet.description).toMatch(/a pet that does not exist answers \{ ok: false, reason: "unknown" \}/);
  });

  it("an operation the server cannot reach is a signed INTERNAL that names no upstream", async () => {
    const { tap } = setup();
    const a = await tap("pet", { id: "1" });
    expect(a.res.status).toBe(500);
    expect(a.json().error).toEqual({ code: "INTERNAL", message: "unavailable" });
    expect((await a.check()).kind).toBe("accepted");
  });

  it("an unknown method is a signed METHOD_NOT_FOUND", async () => {
    const { tap } = setup();
    const a = await tap("transfer", {});
    expect(a.res.status).toBe(404);
    expect(a.json().error.code).toBe("METHOD_NOT_FOUND");
    expect(await a.check()).toMatchObject({ kind: "accepted", ok: false });
  });

  it("binding rule 1: a body that is not JSON, not an object, has a bad id or a forbidden name is refused under id \"\"", async () => {
    const { tap } = setup();
    for (const raw of ["not json", "[1,2]", "null", '{"params":{}}', `{"id":"${"x".repeat(129)}"}`, '{"id":""}', '{"id":7}', '{"id":"a","__proto__":{}}', '{"id":"a","id":"b"}', '{"id":"\\ud800"}']) {
      const a = await tap("profiles", {}, { raw });
      expect(a.res.status, raw).toBe(400);
      expect(a.json().id, raw).toBe("");
      expect(await a.check(), raw).toEqual({ kind: "ownMalformed" });
    }
  });

  it("binding rule 2: params that are not an object, or have no canonical form, are refused under the own id and params {}", async () => {
    const { tap } = setup();
    for (const raw of ['{"id":"r2","params":[1]}', '{"id":"r2","params":"x"}', '{"id":"r2","params":{"a":-0.0}}', '{"id":"r2","params":{"a":9007199254740993}}']) {
      const a = await tap("profiles", {}, { raw, id: "r2" });
      expect(a.json().id, raw).toBe("r2");
      expect(await a.check(), raw).toEqual({ kind: "ownMalformed" });
    }
  });

  it("a method member that differs from the path is refused, not chosen between", async () => {
    const { tap } = setup();
    const a = await tap("profiles", {}, { raw: '{"id":"m1","method":"partners","params":{}}', id: "m1" });
    expect(a.json().error.code).toBe("BAD_REQUEST");
    expect(a.json().id).toBe("m1");
    // a signed BAD_REQUEST over the client's own id is how a client learns its own request was malformed (§8 step 3)
    expect(await a.check({ id: "m1" })).toEqual({ kind: "ownMalformed" });
  });

  it("a body over the limit is a signed 413 under id \"\", whatever the body limit in front of it", async () => {
    const { tap } = setup();
    const a = await tap("teach", {}, { raw: JSON.stringify({ id: "big", params: { pad: "x".repeat(TAP_BODY_LIMIT) } }) });
    expect(a.res.status).toBe(413);
    expect(a.json().id).toBe("");
    expect(await a.check()).toEqual({ kind: "ownMalformed" });
  });

  it("rate limiting is the unsigned 429 of §7, with Retry-After", async () => {
    const { tap } = setup({ tapLimit: 2 });
    await tap("profiles", {}, { ip: "198.51.100.7" });
    await tap("profiles", {}, { ip: "198.51.100.7" });
    const a = await tap("profiles", {}, { ip: "198.51.100.7" });
    expect(a.res.status).toBe(429);
    expect(Number(a.res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = a.json();
    expect(body.sig).toBeUndefined();
    expect(body).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", data: { retryAfterS: expect.any(Number) } } });
    expect(await a.check()).toEqual({ kind: "rateLimited" });
  });

  it("a path that is not a method name is an unsigned route error, a transport failure to a client", async () => {
    const { tap } = setup();
    const a = await tap("not-a-name");
    expect(a.res.status).toBe(404);
    expect(await a.check()).toEqual({ kind: "transport" });
  });

  it("a changed answer is rejected: body, ok, id, ts, container or another signer", async () => {
    const { tap, now } = setup();
    const a = await tap("profiles");
    const env = a.json();
    const as = (e: unknown) => ({ status: 200, text: JSON.stringify(e) });
    const sent = { container, signer: signer.address, id: a.id, method: "profiles", params: {} };
    const opts = { now: now() };
    expect((await verifyEnvelope(as(env), sent, opts)).kind).toBe("accepted");
    expect(await verifyEnvelope(as({ ...env, result: { ...env.result, profiles: [] } }), sent, opts)).toMatchObject({ kind: "binding" });
    const { result, ...rest } = env;
    expect(await verifyEnvelope(as({ ...rest, ok: false, error: { code: "INTERNAL", message: "x" } }), sent, opts)).toMatchObject({ kind: "binding" });
    expect(await verifyEnvelope(as(env), { ...sent, id: "someone-else" }, opts)).toMatchObject({ kind: "binding" });
    expect(await verifyEnvelope(as({ ...env, ts: env.ts + 1 }), sent, opts)).toMatchObject({ kind: "binding" });
    expect(await verifyEnvelope(as(env), sent, { now: now() + 301 })).toMatchObject({ kind: "binding" });
    expect(await verifyEnvelope(as({ ...env, container: "0x0000000000000000000000000000000000000001" }), sent, opts)).toMatchObject({ kind: "binding" });
    const other = privateKeyToAccount(`0x${"3".repeat(64)}`);
    const forged = await signStatement(other, { container, id: a.id, request: { method: "profiles", params: {} }, ok: true, body: result, ts: env.ts });
    expect(await verifyEnvelope(as({ ...env, sig: forged }), sent, opts)).toMatchObject({ kind: "binding" });
    // the same answer cannot be moved to another method's question
    expect(await verifyEnvelope(as(env), { ...sent, method: "partners" }, opts)).toMatchObject({ kind: "binding" });
  });

  it("leaves the GET routes as they were", async () => {
    const { rest } = setup();
    expect((await rest("/api/v1/profiles")).status).toBe(200);
    expect((await (await rest("/api/v1/profiles")).json()).sig).toBeUndefined();
  });
});
