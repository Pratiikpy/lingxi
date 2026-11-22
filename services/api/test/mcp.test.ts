import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RateLimiter } from "../src/limit";
import { handleMcp, withMcp } from "../src/mcp";
import { MCP_TOOLS } from "../src/mcpToolDefs";
import { withTapApi } from "../src/tapApi";
import { verifyEnvelope } from "../src/tap";
import { hiddenText, toolsDigest } from "../src/tapTools";

const dir = join(dirname(fileURLToPath(import.meta.url)), "vectors", "tap");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const KEY = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const signer = privateKeyToAccount(KEY);
const container = "0x86DDaEF00401E3F10418398D67D7189fc458eA95" as Address;
const brave = { label: "brave with you near", when: { event: [3], owner: [1] }, then: { want: 6, mood: 1, nudge: 1 } };

function server() {
  const app = withMcp(new Hono(), { limiter: new RateLimiter(10_000, 60_000) });
  let n = 0;
  const rpc = async (method: string, params?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params !== undefined ? { params } : {}) }) });
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  };
  const raw = (body: string, init: { method?: string; headers?: Record<string, string> } = {}) => app.request("/mcp", { method: init.method ?? "POST", headers: { "content-type": "application/json", ...init.headers }, ...(init.method === "GET" || init.method === "DELETE" ? {} : { body }) });
  return { rpc, raw };
}

describe("the MCP server at /mcp (Streamable HTTP, 2025-11-25)", () => {
  it("initializes, answering with the client's version when it knows it", async () => {
    const { rpc } = server();
    const r = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(r.body.result).toMatchObject({ protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "lingxi" } });
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-11-25");
    expect(r.body.result.instructions).toBeUndefined();
  });

  it("lists exactly the pinned tools, with a digest and no hidden text", async () => {
    const { rpc } = server();
    const tools = (await rpc("tools/list")).body.result.tools;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(["read_pet", "run_spar", "propose_lesson"]);
    expect(toolsDigest(tools)).toBe(toolsDigest(MCP_TOOLS));
    expect(toolsDigest(tools)).toMatch(/^[0-9a-f]{64}$/);
    expect(hiddenText(tools)).toEqual([]);
  });

  it("proposes a lesson: learnable, gates within the limit, the situations it changes", async () => {
    const { rpc } = server();
    const r = (await rpc("tools/call", { name: "propose_lesson", arguments: { rule: brave } })).body.result;
    expect(r.isError).toBeUndefined();
    expect(r.content[0].type).toBe("text");
    expect(r.structuredContent).toMatchObject({ learnable: true, line: "gentle", maxGates: 500 });
    expect(r.structuredContent.gates).toBeGreaterThan(r.structuredContent.gatesBefore);
    // a scary event with the owner here is a quarter of event values times half of owner values: 65536 / 8
    expect(r.structuredContent.changedSituations).toBe(8192);
    expect(r.structuredContent.examples).toHaveLength(3);
    for (const e of r.structuredContent.examples) expect(e).toMatchObject({ after: { want: "cuddle", mood: "calm" } });
  });

  it("a lesson the pet already has is a tool error a model can read, not a protocol error", async () => {
    const { rpc } = server();
    const r = (await rpc("tools/call", { name: "propose_lesson", arguments: { rule: brave, lessons: [brave] } })).body.result;
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ learnable: false, reason: "duplicate" });
  });

  it("runs a spar, the same fight for the same seed", async () => {
    const { rpc } = server();
    const a = (await rpc("tools/call", { name: "run_spar", arguments: { chips: "berserk", vs: "pip", seed: 7 } })).body.result;
    const b = (await rpc("tools/call", { name: "run_spar", arguments: { chips: "berserk", vs: "pip", seed: 7 } })).body.result;
    expect(a).toEqual(b);
    expect(a.structuredContent).toMatchObject({ ran: true, seed: 7 });
  });

  it("arguments that break the schema are -32602; an unknown method -32601; read_pet with no chain -32603", async () => {
    const { rpc } = server();
    for (const args of [{ rule: 5 }, { rule: brave, line: "fierce" }, { rule: { when: { nope: [1] }, then: { want: 1, mood: 1 } } }, { rule: brave, extra: 1 }]) {
      expect((await rpc("tools/call", { name: "propose_lesson", arguments: args })).body.error.code, JSON.stringify(args)).toBe(-32602);
    }
    expect((await rpc("tools/call", { name: "read_pet", arguments: { id: "0" } })).body.error.code).toBe(-32602);
    expect((await rpc("tools/call", { name: "transfer", arguments: {} })).body.error.code).toBe(-32602);
    expect((await rpc("resources/subscribe")).body.error.code).toBe(-32601);
    expect((await rpc("tools/call", { name: "read_pet", arguments: { id: "1" } })).body.error).toEqual({ code: -32603, message: "internal error" });
  });

  it("transport: notifications 202, GET and DELETE 405, batches and bad JSON 400, an unknown protocol version 400", async () => {
    const { raw } = server();
    expect((await raw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);
    expect((await raw("", { method: "GET" })).status).toBe(405);
    expect((await raw("", { method: "DELETE" })).status).toBe(405);
    const batch = await raw(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]));
    expect(batch.status).toBe(400);
    expect((await raw("{not json")).status).toBe(400);
    expect((await raw('{"jsonrpc":"2.0","id":1,"method":"ping","method":"tools/list"}')).status).toBe(400);
    expect((await raw(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { headers: { "mcp-protocol-version": "2099-01-01" } })).status).toBe(400);
    expect((await raw(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70_000) } }))).status).toBe(413);
  });
});

describe("tools bound as signed methods (TAP-15 §4, §5)", () => {
  const sha = toolsDigest(MCP_TOOLS)!;
  const bound = (published: string, now = () => 1_790_000_000) => {
    const app = withTapApi(new Hono(), { signer, container, limiter: new RateLimiter(10_000, 60_000), now, tools: { sha256: published, names: MCP_TOOLS.map((t) => t.name), mcp: (m) => handleMcp(m, {}) } });
    return async (method: string, params: Record<string, unknown>, id = "c1") => {
      const res = await app.request(`/api/v1/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, params }) });
      const text = await res.text();
      return { status: res.status, env: JSON.parse(text), out: await verifyEnvelope({ status: res.status, text }, { container, signer: signer.address, id, method, params }, { now: now() }) };
    };
  };

  it("a bound tool's answer is signed as content and structuredContent", async () => {
    const call = bound(sha);
    const r = await call("propose_lesson", { rule: brave });
    expect(r.status).toBe(200);
    expect(r.out.kind).toBe("accepted");
    expect(Object.keys(r.env.result).sort()).toEqual(["content", "structuredContent"]);
    const err = await call("propose_lesson", { rule: brave, lessons: [brave] });
    expect(err.env.result.isError).toBe(true);
    expect(err.env.ok).toBe(true);
  });

  it("arguments the tool refuses are a signed BAD_REQUEST", async () => {
    const r = await bound(sha)("propose_lesson", { rule: 5 });
    expect(r.status).toBe(400);
    expect(r.env.error.code).toBe("BAD_REQUEST");
    expect(r.out.kind).toBe("accepted");
  });

  it("tools that differ from the published digest are refused with a signed TOOLS_CHANGED", async () => {
    const published = "0".repeat(64);
    const r = await bound(published)("propose_lesson", { rule: brave });
    expect(r.status).toBe(409);
    expect(r.env.error).toMatchObject({ code: "TOOLS_CHANGED", data: { published, current: sha } });
    expect(r.out.kind).toBe("accepted");
  });

  it("reproduces TAP-15's reference envelopes", async () => {
    const v = load("tap15-envelopes.json");
    let served: unknown[] = v.upstreamTools;
    const upstream = async (m: object): Promise<object> => {
      const msg = m as { method: string; params: { name?: string } };
      if (msg.method === "tools/list") return { jsonrpc: "2.0", id: 1, result: { tools: served } };
      const c = (v.cases as Array<{ method: string; envelope: { result?: Record<string, unknown> } }>).find((x) => x.method === msg.params.name && x.envelope.result)!;
      // the upstream server's own _meta is dropped from the signed result
      return { jsonrpc: "2.0", id: 1, result: { ...c.envelope.result, _meta: { upstream: true } } };
    };
    for (const c of v.cases as Array<{ name: string; httpStatus: number; id: string; method: string; params: Record<string, unknown>; envelope: Record<string, unknown> & { ts: number; sig: string; error?: { code: string; data: unknown } } }>) {
      served = c.name.startsWith("upstream description changed") ? v.driftedTools : c.name.startsWith("upstream list has no digest") ? v.undigestibleTools : v.upstreamTools;
      const app = withTapApi(new Hono(), { signer, container, limiter: new RateLimiter(10_000, 60_000), now: () => c.envelope.ts, tools: { sha256: v.toolsSha256, names: v.upstreamTools.map((t: { name: string }) => t.name), mcp: upstream } });
      const res = await app.request(`/api/v1/${c.method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, params: c.params }) });
      const env = await res.json();
      expect(res.status, c.name).toBe(c.httpStatus);
      if (c.envelope.error) {
        // the message text is the reference's own and not normative; the code and data are
        expect(env.error.code, c.name).toBe(c.envelope.error.code);
        expect(env.error.data, c.name).toEqual(c.envelope.error.data);
      } else expect(env, c.name).toEqual(c.envelope);
    }
  });
});
