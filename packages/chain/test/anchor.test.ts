import { describe, expect, it } from "vitest";
import { type Address, type Hex, type PublicClient, createPublicClient, encodeAbiParameters, encodeEventTopics, http, pad, toHex } from "viem";
import { anchorBrains } from "../src/anchor";
import { petRegistryAbi } from "../src/registryAbi";

const REGISTRY = "0x103d7252eb6b2fec22b3f65a6bb605945f280e99" as Address;
const PROCESSOR = "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e" as Address;
const OTHER = "0x000000000000000000000000000000000000beef" as Address;

interface FakeLog {
  address: Address;
  topics: Hex[];
  data: Hex;
}
const hatched = (petId: bigint, brainId: bigint, state: bigint, at: Address = REGISTRY): FakeLog => ({
  address: at,
  topics: encodeEventTopics({ abi: petRegistryAbi, eventName: "Hatched", args: { petId, to: "0x0000000000000000000000000000000000000001" } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint8" }, { type: "address" }, { type: "uint64" }, { type: "uint256" }], [0, PROCESSOR, brainId, state]),
});
const changed = (petId: bigint, brainId: bigint, at: Address = REGISTRY): FakeLog => ({
  address: at,
  topics: encodeEventTopics({ abi: petRegistryAbi, eventName: "BrainChanged", args: { petId } }) as Hex[],
  data: encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "uint8" }], [PROCESSOR, brainId, 8]),
});
const tx = (n: number) => pad(toHex(n), { size: 32 });

/** A chain of receipts by transaction hash, as getTransactionReceipt returns them. */
function chainOf(receipts: Record<string, { block: number; logs: FakeLog[]; status?: "success" | "reverted" }>): PublicClient {
  return {
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = receipts[hash];
      if (!r) throw new Error("no such transaction");
      return { status: r.status ?? "success", blockNumber: BigInt(r.block), logs: r.logs.map((l, i) => ({ ...l, logIndex: i })) };
    },
  } as unknown as PublicClient;
}

// pet 7: hatched with brain 1 at block 100, taught (brain 20) at block 200, taught again (brain 31) at block 300
const honest = chainOf({
  [tx(1)]: { block: 100, logs: [hatched(7n, 1n, 0x5n)] },
  [tx(2)]: { block: 200, logs: [changed(7n, 20n)] },
  [tx(3)]: { block: 300, logs: [changed(7n, 31n)] },
  [tx(4)]: { block: 250, logs: [changed(8n, 20n)] },
  [tx(5)]: { block: 260, logs: [changed(7n, 20n, OTHER)] },
  [tx(6)]: { block: 270, logs: [changed(7n, 20n)], status: "reverted" },
});
const hints = { hatched: tx(1), changes: [tx(2), tx(3)] };

describe("anchoring a replay's brains to the pet's own events on X Layer", () => {
  it("anchors every brain in order, and takes the starting memory from the Hatched event", async () => {
    const r = await anchorBrains(honest, REGISTRY, 7n, [1n, 20n, 31n], hints, 31n);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.anchors.map((a) => [a.brainId, a.block, a.kind])).toEqual([
      [1n, 100n, "hatched"],
      [20n, 200n, "changed"],
      [31n, 300n, "changed"],
    ]);
    expect(r.startState).toBe(0x5n);
  });

  it("refuses a first brain other than the one it hatched with", async () => {
    const r = await anchorBrains(honest, REGISTRY, 7n, [2n, 20n, 31n], hints, 31n);
    expect(r).toMatchObject({ ok: false, reason: "hatchBrain" });
  });

  it("refuses a last brain other than the one on record now", async () => {
    const r = await anchorBrains(honest, REGISTRY, 7n, [1n, 20n], { hatched: tx(1), changes: [tx(2)] }, 31n);
    expect(r).toMatchObject({ ok: false, reason: "notCurrent" });
  });

  it("refuses a replay that skips a brain the pet really held", async () => {
    const r = await anchorBrains(honest, REGISTRY, 7n, [1n, 31n], hints, 31n);
    expect(r).toMatchObject({ ok: false, reason: "skipsChange" });
  });

  it("refuses brains in an order the chain did not record", async () => {
    const swapped = chainOf({
      [tx(1)]: { block: 100, logs: [hatched(7n, 1n, 0n)] },
      [tx(2)]: { block: 300, logs: [changed(7n, 20n)] },
      [tx(3)]: { block: 200, logs: [changed(7n, 31n)] },
    });
    // the chain held 31 before 20, so a replay that runs 20 first has left 31 out at that point
    const r = await anchorBrains(swapped, REGISTRY, 7n, [1n, 20n, 31n], hints, 31n);
    expect(r).toMatchObject({ ok: false, reason: "skipsChange" });
  });

  it("does not count another pet's event, another contract's event, or a reverted transaction", async () => {
    for (const forged of [tx(4), tx(5), tx(6)]) {
      const r = await anchorBrains(honest, REGISTRY, 7n, [1n, 20n], { hatched: tx(1), changes: [forged] }, 20n);
      expect(r, forged).toMatchObject({ ok: false, reason: "unanchored" });
    }
  });

  it("refuses a hatch hint that is not this pet's hatching", async () => {
    const r = await anchorBrains(honest, REGISTRY, 7n, [20n], { hatched: tx(2), changes: [] }, 20n);
    expect(r).toMatchObject({ ok: false, reason: "noHatch" });
  });

  it("says a hint could not be read rather than guessing", async () => {
    const r = await anchorBrains(honest, REGISTRY, 7n, [1n, 20n], { hatched: tx(1), changes: [tx(99)] }, 20n);
    expect(r).toMatchObject({ ok: false, reason: "unanchored" });
  });
});

describe.skipIf(!process.env.LIVE_XLAYER)("pet #1 on X Layer mainnet", () => {
  it("anchors its brain to its own Hatched event", async () => {
    const pub = createPublicClient({ transport: http("https://xlayerrpc.okx.com") }) as PublicClient;
    // the indexer only says which transactions to read; every one is proven from its receipt
    const h = (await (await fetch("https://lingxi.knole.me/api/pets/1/history")).json()) as { hatched: { tx: Hex; brainId: string }; brains: Array<{ tx: Hex }> };
    const r = await anchorBrains(pub, REGISTRY, 1n, [BigInt(h.hatched.brainId)], { hatched: h.hatched.tx, changes: h.brains.map((b) => b.tx) }, BigInt(h.hatched.brainId));
    expect(r.ok).toBe(true);
  }, 30_000);
});
