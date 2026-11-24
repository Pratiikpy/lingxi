/** Reading outside brains from X Layer mainnet, read-only (skipped unless LIVE_XLAYER=1). */
import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { AdoptError, readOutsideCircuit, xLayer } from "../src/index";
import d from "../deployments/xlayer.json";

describe.skipIf(!process.env.LIVE_XLAYER)("outside brains on X Layer mainnet", () => {
  const pub = createPublicClient({ chain: xLayer, transport: http("https://rpc.xlayer.tech") });
  it("reads Lingxi's starter circuits with their real shape and maker", async () => {
    for (const [line, c] of Object.entries(d.circuits).filter(([k]) => ["gentle", "bold", "curious"].includes(k))) {
      const got = await readOutsideCircuit(pub as never, d.processor as `0x${string}`, BigInt(c.id));
      expect([line, got.nIn, got.nOut, got.gates]).toEqual([line, 16, 8, c.gates]);
      expect(got.owner.toLowerCase()).toBe(d.deployer.toLowerCase());
    }
  }, 120_000);
  it("refuses an address that is not a registered processor, and a circuit that does not exist", async () => {
    await expect(readOutsideCircuit(pub as never, d.registry as `0x${string}`, 1n)).rejects.toThrow(AdoptError);
    await expect(readOutsideCircuit(pub as never, d.processor as `0x${string}`, 999999n)).rejects.toMatchObject({
      reason: "noCircuit",
    });
  }, 120_000);
});
