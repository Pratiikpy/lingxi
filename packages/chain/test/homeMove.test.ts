/**
 * P7, check 4: moving a circuit into a home asks X Layer who holds it. A circuit that does not exist has no holder,
 * which is "not yours to move"; a moment when X Layer cannot be read is not that answer, and must not be said as it.
 */
import { describe, expect, it } from "vitest";
import {
  type PublicClient,
  type WalletClient,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
} from "viem";
import { type Home, HomeError, moveIntoHome } from "../src/home";

const me = "0x1111111111111111111111111111111111111111" as const;
const processor = "0x2222222222222222222222222222222222222222" as const;
const home = {
  processor,
  circuit: 5n,
  container: "0x3333333333333333333333333333333333333333",
  endpoint: "0x00",
  opened: true,
  holder: me,
  mailbox: false,
  key: "0x00",
  keyIndex: 0,
} as unknown as Home;
const wallet = { account: { address: me } } as unknown as WalletClient;
const failing = (e: Error) => ({ readContract: () => Promise.reject(e) }) as unknown as PublicClient;
const reverted = () =>
  new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: [], functionName: "ownerOf" }), {
    abi: [],
    functionName: "ownerOf",
  });

describe("moving a circuit into a home asks who holds it (P7)", () => {
  it("a circuit that does not exist has no holder: not yours to move", async () => {
    await expect(moveIntoHome(failing(reverted()), wallet, processor, 7n, home)).rejects.toMatchObject({
      code: "notHolder",
    });
  });

  it("X Layer not answering is said as that, never as the circuit not being yours", async () => {
    const e = await moveIntoHome(failing(new Error("fetch failed")), wallet, processor, 7n, home).catch((x) => x);
    expect(e).toBeInstanceOf(HomeError);
    expect((e as HomeError).code).toBe("unread");
  });
});
