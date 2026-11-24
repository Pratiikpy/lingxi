import { createPublicClient, custom, type Address, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createGoalLedger } from "../src/goals";
import { createIndexer } from "../src/indexer";
import { createSalesCounter } from "../src/numbers";
import { createPacketIndex } from "../src/packets";

const ADDR = "0x00000000000000000000000000000000000000aa" as Address;
const hex = (n: number) => `0x${n.toString(16)}`;

/**
 * A real viem client over a small scripted chain with no events: viem keeps a block number it has read for a few
 * seconds, and the chain here moves on one block right after the client last asked, as it does when a write lands.
 */
function movingChain(start: number) {
  let head = start;
  const pub = createPublicClient({
    transport: custom({
      request: async ({ method }: { method: string }) => {
        if (method === "eth_blockNumber") return hex(head);
        if (method === "eth_getLogs") return [];
        if (method === "eth_getBlockByNumber")
          return { number: hex(head), timestamp: hex(1_800_000_000), hash: `0x${"11".repeat(32)}`, transactions: [] };
        if (method === "eth_chainId") return hex(196);
        throw new Error(`unexpected ${method}`);
      },
    }),
  }) as PublicClient;
  return { pub, step: () => ++head, head: () => head };
}

describe("every catch-up reads to the chain's head as it is now, never to one read moments before", () => {
  it("the goals ledger, the history indexer, the packet index and the sales counter each reach the block just written", async () => {
    const c = movingChain(1_000);
    const goals = createGoalLedger({ rpc: "", registry: ADDR, burners: [], fromBlock: 990, client: c.pub, paceMs: 0 });
    const history = createIndexer({ rpc: "", registry: ADDR, fromBlock: 990, client: c.pub, paceMs: 0 });
    const packets = createPacketIndex({ address: ADDR, fromBlock: 990, client: c.pub, paceMs: 0 });
    const sales = createSalesCounter({
      rpc: "",
      markets: [{ address: ADDR, fromBlock: 990 }],
      client: c.pub,
      paceMs: 0,
    });

    // the client reads the head, then a write lands in the next block
    expect(Number(await c.pub.getBlockNumber())).toBe(1_000);
    c.step();

    await goals.catchUp();
    await history.catchUp();
    await packets.catchUp();
    await sales.catchUp();
    expect(goals.head()).toBe(c.head());
    expect(history.head()).toBe(c.head());
    expect(packets.head()).toBe(c.head());
    expect(sales.head(ADDR)).toBe(c.head());
  });
});
