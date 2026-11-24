import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { FairCeiling, RateLimiter } from "../src/limit";
import { MAX_BATCH, MAX_LOG_BLOCKS, RPC_BODY_MAX, type RpcProxyOptions, vetCalls, withRpcProxy } from "../src/rpc";

type Up = (body: string) => Response | Promise<Response>;
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

function app(ups: Record<string, Up>, limiter?: RateLimiter, more: Partial<RpcProxyOptions> = {}) {
  const calls: string[] = [];
  const a = new Hono();
  withRpcProxy(a, {
    upstreams: Object.keys(ups).filter((u) => u !== more.reserve?.url),
    limiter,
    ...more,
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
  const r = await a.request("/api/rpc", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> | Record<string, unknown>[] };
};
const blockNumber = { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] };

describe("the same-origin RPC door", () => {
  it("forwards an allowed call and hands back the upstream's answer", async () => {
    const { a, calls } = app({
      "https://a": (b) => json({ jsonrpc: "2.0", id: (JSON.parse(b) as { id: number }).id, result: "0x10" }),
    });
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
    const { a } = app({
      "https://a": () => new Response("", { status: 503 }),
      "https://b": () => new Response("<html>", { status: 200 }),
    });
    const r = await post(a, blockNumber);
    expect(r.status).toBe(502);
  });

  it("refuses methods the game never needs before they reach an upstream", async () => {
    const { a, calls } = app({ "https://a": () => json({}) });
    for (const method of [
      "eth_sendTransaction",
      "eth_accounts",
      "personal_sign",
      "debug_traceTransaction",
      "admin_addPeer",
    ]) {
      const r = await post(a, { jsonrpc: "2.0", id: 7, method, params: [] });
      expect((r.body as Record<string, { message: string } | undefined>).error?.message).toContain("not allowed");
    }
    expect(calls).toEqual([]);
  });

  it("keeps batches in order and refuses only the disallowed members", async () => {
    const { a } = app({
      "https://a": (b) =>
        json((JSON.parse(b) as { id: number }[]).map((c) => ({ jsonrpc: "2.0", id: c.id, result: "ok" }))),
    });
    const r = await post(a, [
      blockNumber,
      { jsonrpc: "2.0", id: 2, method: "eth_accounts" },
      { jsonrpc: "2.0", id: 3, method: "eth_chainId" },
    ]);
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
    const { a } = app(
      { "https://a": () => json({ jsonrpc: "2.0", id: 1, result: "0x1" }) },
      new RateLimiter(2, 60_000),
    );
    expect((await post(a, blockNumber, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(429);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "2.2.2.2" })).status).toBe(200);
  });

  it("takes batches of at most ten, each call counted against the caller", async () => {
    const ok = (b: string) =>
      json((JSON.parse(b) as { id: number }[]).map((c) => ({ jsonrpc: "2.0", id: c.id, result: "0x1" })));
    const batch = (n: number) => Array.from({ length: n }, (_, i) => ({ ...blockNumber, id: i }));
    const { a, calls } = app({ "https://a": ok });
    expect(MAX_BATCH).toBe(10);
    expect((await post(a, batch(10))).status).toBe(200);
    expect((await post(a, batch(11))).status).toBe(400);
    expect(calls).toHaveLength(1);
    // a batch is as many requests as it holds: six calls do not fit in a budget of five
    const limited = app({ "https://a": ok }, new RateLimiter(5, 60_000)).a;
    expect((await post(limited, batch(6), { "cf-connecting-ip": "3.3.3.3" })).status).toBe(429);
  });

  it("asks for logs only over a short, stated range of blocks", async () => {
    const { a, calls } = app({
      "https://a": (b) => json({ jsonrpc: "2.0", id: (JSON.parse(b) as { id: number }).id, result: [] }),
    });
    const logs = (filter: Record<string, unknown>) =>
      post(a, { jsonrpc: "2.0", id: 5, method: "eth_getLogs", params: [filter] });
    const msg = (r: { body: unknown }) => (r.body as { error?: { message: string } }).error?.message ?? "";
    expect(MAX_LOG_BLOCKS).toBe(100);
    expect((await logs({ fromBlock: "0x100", toBlock: "0x163" })).body).toEqual({ jsonrpc: "2.0", id: 5, result: [] });
    expect((await logs({ blockHash: `0x${"ab".repeat(32)}` })).body).toEqual({ jsonrpc: "2.0", id: 5, result: [] });
    expect((await logs({})).body).toEqual({ jsonrpc: "2.0", id: 5, result: [] });
    const sent = calls.length;
    expect(msg(await logs({ fromBlock: "0x100", toBlock: "0x164" }))).toContain("100 blocks");
    expect(msg(await logs({ fromBlock: "0x0", toBlock: "latest" }))).toContain("100 blocks");
    expect(msg(await logs({ fromBlock: "earliest" }))).toContain("100 blocks");
    expect(msg(await logs({ fromBlock: "0x200", toBlock: "0x100" }))).toContain("100 blocks");
    expect(msg(await post(a, { jsonrpc: "2.0", id: 5, method: "eth_getLogs", params: ["junk"] }))).toContain(
      "100 blocks",
    );
    expect(calls).toHaveLength(sent);
  });

  it("holds a ceiling for everyone together, so no crowd of addresses can get the upstream to throttle us", async () => {
    const { a } = app({ "https://a": () => json({ jsonrpc: "2.0", id: 1, result: "0x1" }) }, undefined, {
      global: new FairCeiling(3, 60_000),
    });
    for (const ip of ["4.4.4.1", "4.4.4.2", "4.4.4.3"])
      expect((await post(a, blockNumber, { "cf-connecting-ip": ip })).status).toBe(200);
    expect((await post(a, blockNumber, { "cf-connecting-ip": "4.4.4.4" })).status).toBe(429);
  });

  it("shares that ceiling: three callers running hot cannot shut a fourth out of the door (A83)", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    try {
      const { a } = app(
        { "https://a": () => json({ jsonrpc: "2.0", id: 1, result: "0x1" }) },
        new RateLimiter(10_000, 60_000),
        { global: new FairCeiling(12, 60_000) },
      );
      const ask = async (ip: string) => (await post(a, blockNumber, { "cf-connecting-ip": ip })).status;
      for (let i = 0; i < 90; i++) {
        vi.setSystemTime(i * 2_000);
        for (const ip of ["4.4.4.1", "4.4.4.2", "4.4.4.3"]) await ask(ip);
      }
      let served = 0;
      for (let i = 90; i < 120; i++) {
        vi.setSystemTime(i * 2_000);
        for (const ip of ["4.4.4.1", "4.4.4.2", "4.4.4.3"]) await ask(ip);
        if ((await ask("4.4.4.4")) === 200) served++;
      }
      // a fair quarter of 12 a minute is 3
      expect(served).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps our own jobs' upstream for them: the door uses it only as a small, last reserve", async () => {
    let proxyUp = false;
    const { a, calls } = app(
      {
        "https://door": () =>
          proxyUp ? json({ jsonrpc: "2.0", id: 1, result: "0x2" }) : new Response("", { status: 503 }),
        "https://jobs": () => json({ jsonrpc: "2.0", id: 1, result: "0x3" }),
      },
      undefined,
      { reserve: { url: "https://jobs", perMinute: 1 } },
    );
    expect((await post(a, blockNumber)).body).toEqual({ jsonrpc: "2.0", id: 1, result: "0x3" });
    // the reserve's minute is spent: the door says it cannot answer rather than lean on the jobs' upstream
    expect((await post(a, blockNumber)).status).toBe(502);
    expect(calls.filter((u) => u === "https://jobs")).toHaveLength(1);
    proxyUp = true;
    expect((await post(a, blockNumber)).body).toEqual({ jsonrpc: "2.0", id: 1, result: "0x2" });
    // answers from the door's own upstream never spend the reserve
    const fresh = app(
      {
        "https://door": () => json({ jsonrpc: "2.0", id: 1, result: "0x2" }),
        "https://jobs": () => json({ jsonrpc: "2.0", id: 1, result: "0x3" }),
      },
      undefined,
      { reserve: { url: "https://jobs", perMinute: 1 } },
    );
    for (let i = 0; i < 3; i++) await post(fresh.a, blockNumber);
    expect(fresh.calls).not.toContain("https://jobs");
  });
});
