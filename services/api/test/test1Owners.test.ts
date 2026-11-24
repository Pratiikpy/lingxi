import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Address, PublicClient } from "viem";
import { RateLimiter } from "../src/limit";
import { createTest1Index, withTest1Owners } from "../src/test1Owners";

const COLLECTION = "0x0e91460d6823c711643e650a9a4c0cc21de41614" as Address;
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

/** A collection of `supply` tokens: A holds 7 and 4321, B the rest; `failFirst` batches fail whole before answering. */
function chain(supply: number, failFirst = 0) {
  let calls = 0;
  let fails = failFirst;
  const client = {
    getBlockNumber: async () => 123n,
    readContract: async () => BigInt(supply),
    multicall: async ({ contracts }: { contracts: Array<{ args: readonly [bigint] }> }) => {
      calls++;
      if (fails-- > 0) return contracts.map(() => ({ status: "failure", error: new Error("timeout") }));
      return contracts.map((c) => ({ status: "success", result: [7n, 4321n].includes(c.args[0]) ? A : B }));
    },
  } as unknown as PublicClient;
  return { client, calls: () => calls };
}

describe("the TapeCode-Test1 owner index (H9)", () => {
  it("reads every owner in a handful of calls and answers which tokens a wallet holds", async () => {
    const c = chain(10_000);
    const index = createTest1Index({ pub: c.client, collection: COLLECTION, now: () => 1_000 });
    expect(index.tokensOf(A as Address)).toBeNull();
    await index.refresh();
    expect(c.calls()).toBeLessThanOrEqual(12);
    expect(index.tokensOf(A.toUpperCase().replace("0X", "0x") as Address)).toEqual({
      tokens: ["7", "4321"],
      at: 1_000,
      block: 123,
    });
    expect(index.tokensOf("0x00000000000000000000000000000000000000cc")?.tokens).toEqual([]);
  });

  it("asks a failed batch again rather than recording 1,000 tokens as nobody's", async () => {
    const c = chain(2_000, 1);
    const index = createTest1Index({ pub: c.client, collection: COLLECTION });
    await index.refresh();
    expect(index.tokensOf(A as Address)?.tokens).toEqual(["7"]);
  });

  it("serves a wallet's tokens, says when it is not ready (an answer, not an error), and refuses a malformed address", async () => {
    const index = createTest1Index({ pub: chain(10_000).client, collection: COLLECTION });
    const app = withTest1Owners(new Hono(), index, new RateLimiter(10_000, 60_000));
    expect(await (await app.request(`/api/holders/test1/${A}`)).json()).toEqual({ ok: false, reason: "notReady" });
    await index.refresh();
    const r = await app.request(`/api/holders/test1/${A}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, tokens: ["7", "4321"], block: 123 });
    expect((await app.request("/api/holders/test1/not-an-address")).status).toBe(400);
  });
});
