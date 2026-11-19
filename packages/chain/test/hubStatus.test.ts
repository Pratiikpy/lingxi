/**
 * A12: whether letters between homes can open, read without trusting a hub TapeKit has not approved. The TapeSend
 * hub is a proxy; its implementation is read from the proxy's slot and compared with TapeKit's list before anything
 * of it is called, and a hub that cannot be read is closed, never an error that takes the home panel down with it.
 */
import { type Address, type Hex, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { HUB, HUB_IMPLEMENTATIONS_XLAYER, lettersStatus } from "../src/home";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ACCEPTED = HUB_IMPLEMENTATIONS_XLAYER[0]! as Address;
const UNKNOWN: Address = "0xf6b86f44bd039bacc8d3670971d556202d579261";
const PROCESSOR: Address = "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e";
const PROCESSOR_CODE: Hex = "0x6080604052";

/** A chain whose hub proxy points at `impl`, whose pin is `pin` (or reverts), and which records every contract called. */
function chain(impl: Address, pin: Hex | "reverts") {
  const called: Address[] = [];
  const pub = {
    getStorageAt: async ({ address, slot }: { address: Address; slot: Hex }) => (address === HUB && slot === IMPL_SLOT ? (`0x000000000000000000000000${impl.slice(2)}` as Hex) : ("0x" as Hex)),
    readContract: async ({ address }: { address: Address }) => {
      called.push(address);
      if (pin === "reverts") throw new Error(`The contract function "circuitCodehash" reverted.`);
      return pin;
    },
    getCode: async ({ address }: { address: Address }) => (address === PROCESSOR ? PROCESSOR_CODE : undefined),
  };
  return { pub: pub as never, called };
}

describe("letters between homes (A12)", () => {
  it("are closed, as the hub's, when the hub runs an implementation TapeKit has not approved, and nothing of it is called", async () => {
    const c = chain(UNKNOWN, keccak256(PROCESSOR_CODE));
    expect(await lettersStatus(c.pub, PROCESSOR)).toBe("hub");
    expect(c.called).toEqual([]);
  });

  it("are closed, as the processor's, when the approved hub pins another processor's code", async () => {
    const c = chain(ACCEPTED, keccak256("0x00"));
    expect(await lettersStatus(c.pub, PROCESSOR)).toBe("processor");
    expect(c.called).toEqual([ACCEPTED]);
  });

  it("open when the approved hub pins Lingxi's processor code", async () => {
    expect(await lettersStatus(chain(ACCEPTED, keccak256(PROCESSOR_CODE)).pub, PROCESSOR)).toBe("open");
  });

  it("are closed, never an error, when the approved hub's pin cannot be read", async () => {
    expect(await lettersStatus(chain(ACCEPTED, "reverts").pub, PROCESSOR)).toBe("hub");
  });
});
