/**
 * A1 against a real node with the real limit: the claims index reads 3,000 blocks of X Layer mainnet from the red packet
 * contract's deploy block through the official node, with no refusal. It needs the network, so it runs when asked:
 * LINGXI_MAINNET_READS=1 pnpm vitest run test/packets.mainnet.test.ts
 */
import { describe, expect, it } from "vitest";
import { createPacketIndex } from "../src/packets";
import deployment from "../../../packages/chain/deployments/xlayer.json";

describe.skipIf(!process.env.LINGXI_MAINNET_READS)("the claims index on X Layer mainnet (A1)", () => {
  it("reads 3,000 blocks from the contract's deploy block through the official node without a refusal", async () => {
    const from = deployment.redPacketBlock;
    const index = createPacketIndex({
      rpc: "https://xlayerrpc.okx.com",
      address: deployment.redPacket as `0x${string}`,
      fromBlock: from,
      paceMs: 150,
    });
    await index.catchUp(30);
    expect(index.head()).toBe(from + 30 * 100 - 1);
  }, 240_000);
});
