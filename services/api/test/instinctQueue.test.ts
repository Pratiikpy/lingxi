/**
 * A115: an instinct relay's reads run before the tape-out queue, capped, so a circuit made to take many slow reads holds
 * up no paid tape-out, and is refused after at most MAX_CIRCUIT_READS reads.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { NAND, REF, STARTERS, encode, type Element } from "@lingxi/brain";
import { MAX_CIRCUIT_READS } from "@lingxi/chain";
import { BrainRelayer } from "../src/relayer";

const CPU = "0x00000000000000000000000000000000000000cc" as Address;
const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const READ_MS = 40;

describe("an instinct relay holds up no tape-out (A115)", () => {
  it("its slow reads run apart from the queue, and a 300-REF circuit is refused after at most the cap", async () => {
    const relayer = new BrainRelayer({ rpc: "http://127.0.0.1:9", processor: CPU, key: generatePrivateKey(), storeFile: join(mkdtempSync(join(tmpdir(), "lx-q-")), "brains.json"), maxPerDay: 50 });
    // circuit 7 REFs 300 distinct one-gate circuits; every read takes READ_MS, as a busy node does
    const top: Element[] = Array.from({ length: 300 }, (_, i) => ({ op: REF, ins: [2], cpu: CPU, id: BigInt(1000 + i), nOut: 1, firstOut: 18 + i }) as Element);
    const leaf: Element[] = [{ op: NAND, ins: [2, 2], nOut: 1, firstOut: 3 } as Element];
    let netlistReads = 0;
    const fake = {
      readContract: async ({ functionName, args }: { functionName: string; args?: [bigint] }) => {
        await new Promise((r) => setTimeout(r, READ_MS));
        if (functionName === "isCPU") return true;
        const id = args![0];
        if (functionName === "circuitInfo") return id === 7n || id === 1n ? [16n, 8n, 0n, 0n] : [1n, 1n, 0n, 1n];
        if (functionName === "netlist") {
          netlistReads++;
          return toHex(encode(id === 7n ? top : leaf));
        }
        throw new Error(functionName);
      },
    };
    const inner = relayer as unknown as { pub: unknown; tapeBytes: () => Promise<unknown> };
    inner.pub = fake;
    // a tape-out answers at once here: what is measured is how long it waits in line
    inner.tapeBytes = async () => ({ ok: true, processor: CPU, brainId: "42", reused: true });

    const finished: string[] = [];
    const instinct = relayer.relayInstinct({ own: "1", processor: CPU, id: "7" }).then((r) => (finished.push("instinct"), r));
    await new Promise((r) => setTimeout(r, READ_MS));
    // a paid tape-out asked while the instinct is still being read finishes first: it never waits for those reads
    const paid = await relayer.relayProgram(STARTERS.gentle).then((r) => (finished.push("paid"), r));
    expect(paid.ok, "the paid tape-out went through").toBe(true);
    expect(await instinct).toMatchObject({ ok: false, reason: "tooBig" });
    expect(finished).toEqual(["paid", "instinct"]);
    expect(netlistReads).toBeLessThanOrEqual(MAX_CIRCUIT_READS);
  });
});
