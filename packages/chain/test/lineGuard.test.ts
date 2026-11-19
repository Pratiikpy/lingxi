/**
 * A18: a pet's line on chain always matches its state. Mainnet pet #2 was hatched with line 0 and a bold pet's
 * starting state, by a script that passed the line's index and its name separately; a day saved over another line's
 * pet could never be undone. Both writes now check the state's own line before any wallet prompt.
 */
import { describe, expect, it, vi } from "vitest";
import { type Address, type Hex } from "viem";
import { LineMismatchError, checkpointOnChain, hatchOnChain, type Deployment } from "../src/registry";

const OWNER: Address = "0x00000000000000000000000000000000000000aa";
const d = { registry: "0x00000000000000000000000000000000000000bb", processor: "0x00000000000000000000000000000000000000cc", circuits: { gentle: { id: 1 }, bold: { id: 2 }, curious: { id: 3 } } } as unknown as Deployment;
/** A state word whose line bits (152-153) say `line`. */
const stateOf = (line: number) => (BigInt(line) << 152n) | 0x1234n;

function chain(recordedLine = 0) {
  const simulate = vi.fn(async (_: { args: readonly unknown[] }) => {
    throw new Error("stop: simulated");
  });
  const pub = {
    simulateContract: simulate,
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "pet" ? { line: recordedLine } : undefined),
  };
  return { pub: pub as never, wallet: { account: { address: OWNER } } as never, simulate };
}

describe("a pet's line on chain matches its state (A18)", () => {
  it("hatches with the index of the line it is given by name", async () => {
    const c = chain();
    await expect(hatchOnChain(c.pub, c.wallet, d, "bold", stateOf(1))).rejects.toThrow(/stop/);
    expect(c.simulate.mock.calls[0]![0].args[1]).toBe(1);
    expect(c.simulate.mock.calls[0]![0].args[3]).toBe(2n);
  });

  it("refuses a starting state of another line before any wallet prompt", async () => {
    const c = chain();
    await expect(hatchOnChain(c.pub, c.wallet, d, "gentle", stateOf(1))).rejects.toBeInstanceOf(LineMismatchError);
    expect(c.simulate).not.toHaveBeenCalled();
  });

  it("refuses to save a state of another line over a pet before any wallet prompt", async () => {
    const c = chain(0);
    await expect(checkpointOnChain(c.pub, c.wallet, d, 2n, 2, stateOf(1), `0x${"00".repeat(32)}` as Hex)).rejects.toBeInstanceOf(LineMismatchError);
    expect(c.simulate).not.toHaveBeenCalled();
  });

  it("saves a state of the pet's own line", async () => {
    const c = chain(1);
    await expect(checkpointOnChain(c.pub, c.wallet, d, 3n, 2, stateOf(1), `0x${"00".repeat(32)}` as Hex)).rejects.toThrow(/stop/);
    expect(c.simulate).toHaveBeenCalledOnce();
  });
});
