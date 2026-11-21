/**
 * H4: the relayer hatches a pet to a player's device key. `hatchOnChain` sends the hatch from the signer to the address
 * it is given, and reads the pet's id from the mined event for that address, never the signer's.
 */
import { describe, expect, it, vi } from "vitest";
import { type Address, type Hex, encodeAbiParameters, encodeEventTopics } from "viem";
import { hatchOnChain, type Deployment } from "../src/registry";
import { petRegistryAbi } from "../src/registryAbi";

const RELAYER: Address = "0x00000000000000000000000000000000000000aa";
const DEVICE: Address = "0x00000000000000000000000000000000000000dd";
const d = { registry: "0x00000000000000000000000000000000000000bb", processor: "0x00000000000000000000000000000000000000cc", circuits: { gentle: { id: 1 }, bold: { id: 2 }, curious: { id: 3 } } } as unknown as Deployment;
const hatched = (petId: bigint, to: Address) => ({
  address: d.registry,
  topics: encodeEventTopics({ abi: petRegistryAbi, eventName: "Hatched", args: { petId, to } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint8" }, { type: "address" }, { type: "uint64" }, { type: "uint256" }], [0, d.processor, 1n, 0n]),
});

function chain(minedTo: Address) {
  const simulate = vi.fn(async (q: { args: readonly unknown[] }) => ({ request: q }));
  const pub = { simulateContract: simulate, waitForTransactionReceipt: async () => ({ status: "success", transactionHash: "0x01", logs: [hatched(7n, minedTo)] }) };
  const wallet = { account: { address: RELAYER }, writeContract: async () => "0x01" as Hex };
  return { pub: pub as never, wallet: wallet as never, simulate };
}

describe("a hatch sent for someone else (H4)", () => {
  it("names the given address as the owner and reads the pet minted to it", async () => {
    const c = chain(DEVICE);
    const r = await hatchOnChain(c.pub, c.wallet, d, "gentle", 0x1234n, undefined, DEVICE);
    expect(c.simulate.mock.calls[0]![0].args[0]).toBe(DEVICE);
    expect(r.petId).toBe(7n);
  });
  it("without one, hatches to the signer as before", async () => {
    const c = chain(RELAYER);
    await hatchOnChain(c.pub, c.wallet, d, "gentle", 0x1234n);
    expect(c.simulate.mock.calls[0]![0].args[0]).toBe(RELAYER);
  });
  it("refuses a receipt whose pet went to anyone else", async () => {
    const c = chain(RELAYER);
    await expect(hatchOnChain(c.pub, c.wallet, d, "gentle", 0x1234n, undefined, DEVICE)).rejects.toThrow(/no pet/);
  });
});
