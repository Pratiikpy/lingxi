/**
 * A75: the relayer says how many tape-outs a request sent, so the sponsor's caps are charged for each. Offline: the
 * relayer's chain client and wallet answer as X Layer would, and each tape-out mines a new circuit id.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { familyOf } from "@lingxi/game";

let nextId = 500n;
vi.mock("@lingxi/chain", async (real) => ({
  ...(await real<typeof import("@lingxi/chain")>()),
  circuitIdFrom: () => nextId++,
}));
const { BrainRelayer } = await import("../src/relayer");

/** A relayer whose chain answers every read and mines every tape-out; `sends` counts the tape-outs sent. */
function offlineRelayer() {
  const relayer = new BrainRelayer({
    rpc: "http://127.0.0.1:9",
    processor: "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e",
    key: generatePrivateKey(),
    storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"),
    maxPerDay: 100,
    maxPerHour: 100,
  });
  const sends: string[] = [];
  vi.spyOn(relayer, "balance").mockResolvedValue(10n ** 18n);
  const r = relayer as unknown as {
    pub: Record<string, unknown>;
    wallet: Record<string, unknown>;
    mintCalls: () => Promise<number>;
  };
  r.mintCalls = async () => 0;
  r.pub = {
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "transistors"
        ? "0x92DFda52386386Be40EFd7becB545139372C7139"
        : functionName === "balanceOf"
          ? 10n ** 9n
          : functionName === "TAPEOUT_FEE"
            ? 0n
            : functionName === "circuitInfo"
              ? [16n, 8n, 8n, 0n]
              : 0n,
    simulateContract: async () => ({}),
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  };
  r.wallet = {
    account: { address: "0x0000000000000000000000000000000000000001" },
    writeContract: async () => (sends.push("tape"), `0x${"ab".repeat(32)}`),
  };
  return { relayer, sends };
}

describe("the relayer counts the tape-outs each request sends (A75)", () => {
  const family = familyOf({ name: "A", line: "gentle", lessons: [] }, { name: "B", line: "bold", lessons: [] });

  it("a taught child sends its two halves and its glue: three; asked again, nothing", async () => {
    const { relayer, sends } = offlineRelayer();
    const first = await relayer.relayChild({ family, lessons: [] });
    expect(first).toMatchObject({ ok: true, sent: 3 });
    expect(sends).toHaveLength(3);
    expect(await relayer.relayChild({ family, lessons: [] }), "all three already taped out").toMatchObject({
      ok: true,
      reused: true,
      sent: 0,
    });
  });

  it("a birth sends its glue alone, and a brain one tape-out", async () => {
    const { relayer } = offlineRelayer();
    expect(await relayer.relayChild({ parents: ["1", "2"] })).toMatchObject({ ok: true, sent: 1 });
    expect(await relayer.relay("curious", [])).toMatchObject({ ok: true, sent: 1 });
  });
});
