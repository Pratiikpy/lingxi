/**
 * H4: the relayer keeps a pet on X Layer for a device key. Offline: the chain client and wallet answer as X Layer
 * would; `sent` records each transaction in order.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type Address, type Hex, encodeAbiParameters, encodeEventTopics } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { petRegistryAbi, type Deployment } from "@lingxi/chain";
import { BrainRelayer } from "../src/relayer";
import { SPONSOR_GRANT_WEI, SPONSOR_SET_ASIDE_WEI } from "../src/sponsor";

const DEVICE = "0x00000000000000000000000000000000000000dd" as Address;
const d = {
  registry: "0x00000000000000000000000000000000000000bb",
  processor: "0x00000000000000000000000000000000000000cc",
  circuits: { gentle: { id: 1 }, bold: { id: 2 }, curious: { id: 3 } },
} as unknown as Deployment;
const GENTLE = 0x1234n;
const hatchedLog = (petId: bigint, to: Address) => ({
  address: d.registry,
  topics: encodeEventTopics({ abi: petRegistryAbi, eventName: "Hatched", args: { petId, to } }) as Hex[],
  data: encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "uint64" }, { type: "uint256" }],
    [0, d.processor, 1n, 0n],
  ),
});

function offline(
  o: { balance?: bigint; hatchStatus?: "success" | "reverted"; grantFails?: boolean; noFees?: boolean } = {},
) {
  const relayer = new BrainRelayer({
    rpc: "http://127.0.0.1:9",
    processor: d.processor,
    key: generatePrivateKey(),
    storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"),
    maxPerDay: 100,
    reserveWei: 10_000_000_000_000_000n,
  });
  vi.spyOn(relayer, "balance").mockResolvedValue(o.balance ?? 10n ** 18n);
  const sent: Array<{ kind: string; to?: string; value?: bigint }> = [];
  const r = relayer as unknown as { pub: Record<string, unknown>; wallet: Record<string, unknown> };
  r.pub = {
    simulateContract: async (q: unknown) => ({ request: q }),
    waitForTransactionReceipt: async ({ hash }: { hash: string }) =>
      hash === "0xhatch"
        ? {
            status: o.hatchStatus ?? "success",
            transactionHash: hash,
            logs: [hatchedLog(41n, DEVICE)],
            ...(o.noFees ? {} : { gasUsed: 200_000n, effectiveGasPrice: 50_000_000n }),
          }
        : {
            status: "success",
            transactionHash: hash,
            logs: [],
            ...(o.noFees ? {} : { gasUsed: 21_000n, effectiveGasPrice: 50_000_000n }),
          },
  };
  r.wallet = {
    account: { address: "0x0000000000000000000000000000000000000001" },
    writeContract: async (q: { functionName: string; args: readonly unknown[] }) => (
      sent.push({ kind: q.functionName, to: String(q.args[0]) }),
      "0xhatch"
    ),
    sendTransaction: async (q: { to: string; value: bigint }) => {
      if (o.grantFails) throw new Error("nonce too low");
      sent.push({ kind: "grant", to: q.to, value: q.value });
      return "0xgrant";
    },
  };
  return { relayer, sent };
}

describe("the relayer keeps a pet for a device key (H4)", () => {
  it("hatches the pet to the device key, then sends that key its gas", async () => {
    const { relayer, sent } = offline();
    const r = await relayer.sponsorHatch(d, DEVICE, "gentle", GENTLE);
    expect(r).toMatchObject({ ok: true, petId: "41", hatchTx: "0xhatch", grantTx: "0xgrant" });
    expect(sent).toEqual([
      { kind: "hatch", to: DEVICE },
      { kind: "grant", to: DEVICE, value: SPONSOR_GRANT_WEI },
    ]);
  });

  it("says what the sends cost, read from their receipts, and the most a pet may cost where a receipt does not say (B9)", async () => {
    const { relayer } = offline();
    const r = await relayer.sponsorHatch(d, DEVICE, "gentle", GENTLE);
    // the hatch's gas (200 000 x 0.05 gwei), the grant, and the grant's gas (21 000 x 0.05 gwei)
    expect(r).toMatchObject({ ok: true, spentWei: 200_000n * 50_000_000n + SPONSOR_GRANT_WEI + 21_000n * 50_000_000n });
    const blind = offline({ noFees: true });
    expect(await blind.relayer.sponsorHatch(d, DEVICE, "gentle", GENTLE)).toMatchObject({
      ok: true,
      spentWei: SPONSOR_SET_ASIDE_WEI,
    });
  });

  it("sends nothing when the OKB is held for season keepsakes", async () => {
    const { relayer, sent } = offline({ balance: 10_000_000_000_000_000n });
    expect(await relayer.sponsorHatch(d, DEVICE, "gentle", GENTLE)).toMatchObject({
      ok: false,
      reason: "relayLow",
      spent: false,
    });
    expect(sent).toEqual([]);
  });

  it("a hatch that reverts says its gas was spent, and sends no gas after it", async () => {
    const { relayer, sent } = offline({ hatchStatus: "reverted" });
    expect(await relayer.sponsorHatch(d, DEVICE, "gentle", GENTLE)).toMatchObject({
      ok: false,
      reason: "error",
      spent: true,
    });
    expect(sent.map((s) => s.kind)).toEqual(["hatch"]);
  });

  it("a pet whose gas did not go out is still the player's, and says so", async () => {
    const { relayer } = offline({ grantFails: true });
    expect(await relayer.sponsorHatch(d, DEVICE, "gentle", GENTLE)).toMatchObject({
      ok: true,
      petId: "41",
      hatchTx: "0xhatch",
      grantTx: null,
    });
  });

  it("the gas alone, for a pet that never got it", async () => {
    const { relayer, sent } = offline();
    expect(await relayer.sponsorGrant(DEVICE)).toMatchObject({ ok: true, grantTx: "0xgrant" });
    expect(sent).toEqual([{ kind: "grant", to: DEVICE, value: SPONSOR_GRANT_WEI }]);
  });
});
