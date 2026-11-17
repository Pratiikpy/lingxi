import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { RateLimiter } from "../src/limit";
import { RPC_BODY_MAX, vetCalls, withRpcProxy } from "../src/rpc";

type Up = (body: string) => Response | Promise<Response>;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

function app(ups: Record<string, Up>, limiter?: RateLimiter) {
  const calls: string[] = [];
  const a = new Hono();
  withRpcProxy(a, {
    upstreams: Object.keys(ups),
    limiter,
    timeoutMs: 200,
    fetch: ((url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      // honours the abort signal the way a real fetch does, so the timeout test means something
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        Promise.resolve()
          .then(() => ups[String(url)]!(String(init?.body)))
          .then(resolve, reject);
      });
    }) as typeof fetch,
  });
  return { a, calls };
}
const post = async (a: Hono, body: unknown, headers: Record<string, string> = {}) => {
  const r = await a.request("/api/rpc", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> | Record<string, unknown>[] };
};
const blockNumber = { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] };

describe("the same-origin RPC door", () => {
  it("forwards an allowed call and hands back the upstream's answer", async () => {
    const { a, calls } = app({ "https://a": (b) => json({ jsonrpc: "2.0", id: (JSON.parse(b) as { id: number }).id, result: "0x10" }) });
    const r = await post(a, blockNumber);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ jsonrpc: "2.0", id: 1, result: "0x10" });
    expect(calls).toEqual(["https://a"]);
  });

  it("falls to the next upstream when the first rate-limits, errors or times out", async () => {
    const { a, calls } = app({
      "https://limited": () => new Response("slow down", { status: 429 }),
      "https://down": () => {
        throw new TypeError("fetch failed");
      },
      "https://slow": () => new Promise<Response>((res) => setTimeout(() => res(json({})), 2000)),
      "https://ok": () => json({ jsonrpc: "2.0", id: 1, result: "0x11" }),
    });
    const r = await post(a, blockNumber);
    expect(r.body).toEqual({ jsonrpc: "2.0", id: 1, result: "0x11" });
    expect(calls).toEqual(["https://limited", "https://down", "https://slow", "https://ok"]);
  });

  it("answers 502 when no upstream answers, without inventing a result", async () => {
    const { a } = app({ "https://a": () => new Response("", { status: 503 }), "https://b": () => new Response("<html>", { status: 200 }) });
    const r = await post(a, blockNumber);
    expect(r.status).toBe(502);
  });

  it("refuses methods the game never needs before they reach an upstream", async () => {
    const { a, calls } = app({ "https://a": () => json({}) });
    for (const method of ["eth_sendTransaction", "eth_accounts", "personal_sign", "debug_traceTransaction", "admin_addPeer"]) {
      const r = await post(a, { jsonrpc: "2.0", id: 7, method, params: [] });
      expect((r.body as Record<string, { message: string } | undefined>).error?.message).toContain("not allowed");
    }
    expect(calls).toEqual([]);
  });

  it("keeps batches in order and refuses only the disallowed members", async () => {
    const { a } = app({ "https://a": (b) => json((JSON.parse(b) as { id: number }[]).map((c) => ({ jsonrpc: "2.0", id: c.id, result: "ok" }))) });
    const r = await post(a, [blockNumber, { jsonrpc: "2.0", id: 2, method: "eth_accounts" }, { jsonrpc: "2.0", id: 3, method: "eth_chainId" }]);
    const rows = r.body as Record<string, unknown>[];
    expect(rows.map((x) => x.id)).toEqual([1, 3, 2]);
    expect(rows[2]?.error).toBeDefined();
  });

  it("refuses junk, oversize bodies, empty batches and non-calls", async () => {
    const { a } = app({ "https://a": () => json({}) });
    expect((await post(a, "{")).status).toBe(400);
    expect((await post(a, [])).status).toBe(400);
    expect((await post(a, { jsonrpc: "2.0", id: 1 })).status).toBe(400);
    expect((await post(a, [1, 2])).status).toBe(400);
    expect((await post(a, "x".repeat(RPC_BODY_MAX + 1))).status).toBe(413);
    expect(vetCalls(null)).toBeNull();
  });

  it("limits one caller without touching another", async () => {
    const { a } = app({ "https://a": () => json({ jsonrpc: "2.0", id: 1, result: "0x1" }) }, new RateLimiter(2, 60_000));
    expect((await post(a, blockNumber, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(429);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "2.2.2.2" })).status).toBe(200);
  });
});
