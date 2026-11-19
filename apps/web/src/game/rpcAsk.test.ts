import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, multicall3Abi, type Hex } from "viem";
import { xLayer } from "@lingxi/chain";
import { type Endpoints, makeProofClient, proofRequest, rotated } from "./rpcAsk";

type Reply = { status: number; body?: unknown } | "network";
/** A fetch that answers each URL from a script and records which URLs were asked. */
function scripted(replies: Record<string, Reply[]>) {
  const asked: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    asked.push(url);
    const next = replies[url]?.shift() ?? { status: 500 };
    if (next === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { "content-type": "application/json" } });
  });
  return { fetcher: fetcher as unknown as typeof fetch, asked };
}
const ok = (result: unknown) => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result } });
const ends: Endpoints = { mine: null, publicRpcs: ["https://a.example", "https://b.example"], fallback: "https://lingxi.example/api/rpc" };

describe("the proof page's reads of X Layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks a public endpoint and says which one answered", async () => {
    const { fetcher, asked } = scripted({ "https://a.example": [ok("0xc4")] });
    const r = await proofRequest(ends, { method: "eth_chainId" }, { fetcher });
    expect(r).toEqual({ result: "0xc4", host: "a.example", fallback: false });
    expect(asked).toEqual(["https://a.example"]);
  });

  it("moves to the next public endpoint on a rate limit, an outage or a refused connection", async () => {
    for (const first of [{ status: 429 }, { status: 503 }, "network" as const, { status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: -32005, message: "rate limit exceeded" } } }]) {
      const { fetcher, asked } = scripted({ "https://a.example": [first], "https://b.example": [ok("0x1")] });
      const r = await proofRequest(ends, { method: "eth_blockNumber" }, { fetcher });
      expect(r.host).toBe("b.example");
      expect(asked).toEqual(["https://a.example", "https://b.example"]);
    }
  });

  it("uses Lingxi's server only when every public endpoint failed, and marks it", async () => {
    const { fetcher, asked } = scripted({ "https://a.example": [{ status: 503 }], "https://b.example": ["network"], "https://lingxi.example/api/rpc": [ok("0x2")] });
    const r = await proofRequest(ends, { method: "eth_blockNumber" }, { fetcher });
    expect(r).toEqual({ result: "0x2", host: "lingxi.example", fallback: true });
    expect(asked.at(-1)).toBe("https://lingxi.example/api/rpc");
  });

  it("asks the judge's own endpoint first, before any of ours", async () => {
    const { fetcher, asked } = scripted({ "https://mine.example": [ok("0x3")] });
    const r = await proofRequest({ ...ends, mine: "https://mine.example" }, { method: "eth_blockNumber" }, { fetcher });
    expect(r.host).toBe("mine.example");
    expect(asked).toEqual(["https://mine.example"]);
  });

  it("passes a contract's revert straight back rather than asking elsewhere", async () => {
    const revert = { status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted", data: "0x12345678" } } };
    const { fetcher, asked } = scripted({ "https://a.example": [revert] });
    await expect(proofRequest(ends, { method: "eth_call" }, { fetcher })).rejects.toMatchObject({ code: 3, data: "0x12345678" });
    expect(asked).toEqual(["https://a.example"]);
  });

  it("fails plainly when nothing answers", async () => {
    const { fetcher } = scripted({});
    await expect(proofRequest({ ...ends, fallback: null }, { method: "eth_blockNumber" }, { fetcher })).rejects.toThrow(/no endpoint answered/);
  });
});

describe("spreading a page's requests over the public nodes (A29)", () => {
  it("starts each request at the next node, so no node takes the page's whole load", () => {
    const nodes = ["https://a.example", "https://b.example"];
    expect([0, 1, 2, 3].map((n) => rotated(nodes, n)[0])).toEqual(["https://a.example", "https://b.example", "https://a.example", "https://b.example"]);
    expect(rotated(nodes, 1)).toEqual(["https://b.example", "https://a.example"]);
    expect(rotated([], 3)).toEqual([]);
  });
});

describe("the proof client asks the public nodes little, and in turn (A29)", () => {
  const nodes = ["https://a.example", "https://b.example"];
  const ends = (n: number): Endpoints => ({ mine: null, publicRpcs: rotated(nodes, n), fallback: null });
  /** A node that answers a block number, and a Multicall3 call with 42 for every read in it; it records each request. */
  const node = () => {
    const asked: Array<{ url: string; method: string }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body)) as { method: string; params: Array<{ data?: Hex }> };
      asked.push({ url, method });
      let result: unknown = "0x10";
      if (method === "eth_call") {
        const { args } = decodeFunctionData({ abi: multicall3Abi, data: params[0]!.data! });
        const calls = args[0] as readonly unknown[];
        result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: calls.map(() => ({ success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [42n]) })) });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    }) as unknown as typeof fetch;
    return { asked, fetcher };
  };

  it("sends reads made together as one Multicall3 request", async () => {
    const n = node();
    const client = makeProofClient(xLayer, ends, 0, () => undefined, n.fetcher);
    const token = "0x0000000000000000000000000000000000000abc";
    const read = (who: Hex) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    expect(await Promise.all([read("0x00000000000000000000000000000000000000a1"), read("0x00000000000000000000000000000000000000b2"), read("0x00000000000000000000000000000000000000c3")])).toEqual([42n, 42n, 42n]);
    expect(n.asked).toEqual([{ url: "https://a.example", method: "eth_call" }]);
  });

  it("starts each request at the next node", async () => {
    const n = node();
    const client = makeProofClient(xLayer, ends, 0, () => undefined, n.fetcher);
    for (let i = 0; i < 4; i++) await client.getBlockNumber({ cacheTime: 0 });
    expect(n.asked.map((a) => a.url)).toEqual(["https://a.example", "https://b.example", "https://a.example", "https://b.example"]);
  });
});

