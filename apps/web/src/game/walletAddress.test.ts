// @vitest-environment happy-dom
/** C3: a check that only reads a wallet asks for its address and nothing else: no network switch, no signature. */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("reading a wallet's address (C3)", () => {
  it("asks only for the accounts, never to switch or add a network", async () => {
    const asked: string[] = [];
    vi.stubGlobal("ethereum", { request: async ({ method }: { method: string }) => (asked.push(method), method === "eth_requestAccounts" ? ["0x00000000000000000000000000000000000000aa"] : null) });
    const { walletAddress } = await import("./chain");
    expect(await walletAddress()).toBe("0x00000000000000000000000000000000000000aa");
    expect(asked).toEqual(["eth_requestAccounts"]);
  });
});
