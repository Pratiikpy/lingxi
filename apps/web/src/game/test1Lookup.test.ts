// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { encodeFunctionData, multicall3Abi, parseAbi } from "viem";
import { test1Lookup, TEST1_PER_CALL } from "./test1Lookup";

const WALLET = "0x00000000000000000000000000000000000000aa";
const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

describe("finding a holder's TapeCode-Test1 (H9)", () => {
  it("passes the index's tokens on as a hint, with the batch size for this door", async () => {
    expect(await test1Lookup(WALLET, answer({ ok: true, tokens: ["7", "4321"], at: 1, block: 2 }))).toEqual({
      perCall: TEST1_PER_CALL,
      candidates: [7n, 4321n],
    });
  });

  it("without a usable answer it gives no hint, and the game reads every owner itself", async () => {
    for (const body of [{ ok: false, reason: "notReady" }, { ok: true, tokens: ["x"] }, { ok: true }, "nonsense"])
      expect(await test1Lookup(WALLET, answer(body))).toEqual({ perCall: TEST1_PER_CALL });
    expect(
      await test1Lookup(WALLET, (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch),
    ).toEqual({ perCall: TEST1_PER_CALL });
  });

  it("a batch of owners through the server's door fits its request limit", () => {
    // the JSON-RPC request viem sends for one multicall of TEST1_PER_CALL ownerOf calls, measured, not estimated
    const ownerOf = parseAbi(["function ownerOf(uint256) view returns (address)"]);
    const calls = Array.from({ length: TEST1_PER_CALL }, (_, k) => ({
      target: "0x0e91460d6823c711643e650a9a4c0cc21de41614" as const,
      allowFailure: true,
      callData: encodeFunctionData({ abi: ownerOf, functionName: "ownerOf", args: [BigInt(10_000 - k)] }),
    }));
    const data = encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] });
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11", data }, "latest"],
    });
    // /api/rpc takes 64 KB (bodyLimits.ts, its default) and at most 128,000 characters (rpc.ts)
    expect(body.length).toBeLessThan(64 * 1024);
  });
});
