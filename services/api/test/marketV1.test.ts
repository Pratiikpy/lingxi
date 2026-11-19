/**
 * A23: which OKB-market (OutfitMarket V1) listings a sale retired. V1 does not bump a seller's nonce on a sale, so a
 * listing beside one that sold comes back once the seller holds a copy again; the watch applies V2's rule from V1's
 * own events: a sale retires every other listing of that design by that seller made before it.
 */
import { describe, expect, it } from "vitest";
import { type Address, type PublicClient } from "viem";
import { createListingWatch, retiredBy } from "../src/marketV1";

const ALICE: Address = "0x00000000000000000000000000000000000000a1";
const BOB: Address = "0x00000000000000000000000000000000000000b0";
const MARKET: Address = "0x00000000000000000000000000000000000000cc";

const listed = (listingId: number, seller: Address, id: number, block: number, logIndex = 0) => ({ eventName: "Listed" as const, args: { listingId: BigInt(listingId), seller, id: BigInt(id) }, blockNumber: BigInt(block), logIndex });
const sold = (listingId: number, block: number, logIndex = 0) => ({ eventName: "Sold" as const, args: { listingId: BigInt(listingId) }, blockNumber: BigInt(block), logIndex });

describe("listings a V1 sale retired (A23)", () => {
  it("a sale retires the seller's earlier listings of that design, and only those", () => {
    const events = [
      listed(1, ALICE, 5, 10), // cheap, forgotten
      listed(2, ALICE, 5, 11), // dear, sells
      listed(3, ALICE, 6, 12), // another design
      listed(4, BOB, 5, 13), // another seller
      sold(2, 20),
      listed(5, ALICE, 5, 21), // listed after the sale: fresh
    ];
    expect([...retiredBy(events)].sort()).toEqual(["1"]);
  });

  it("a listing made in the sale's own block counts by its place in the block", () => {
    expect([...retiredBy([listed(1, ALICE, 5, 30, 0), listed(2, ALICE, 5, 31, 0), listed(3, ALICE, 5, 40, 5), sold(2, 40, 3)])].sort()).toEqual(["1"]);
    expect([...retiredBy([listed(1, ALICE, 5, 30, 0), listed(2, ALICE, 5, 31, 0), listed(3, ALICE, 5, 40, 1), sold(2, 40, 3)])].sort()).toEqual(["1", "3"]);
  });

  it("a part sale leaves the sold listing itself open", () => {
    expect([...retiredBy([listed(7, ALICE, 5, 10), sold(7, 11), sold(7, 12)])]).toEqual([]);
  });

  it("walks the market in windows, keeps its place, and says when it has caught up", async () => {
    const all = [listed(1, ALICE, 5, 105), listed(2, ALICE, 5, 150), sold(2, 260)];
    let head = 300n;
    const client = {
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => all.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock),
    } as unknown as PublicClient;
    const watch = createListingWatch({ rpc: "", market: MARKET, fromBlock: 100, client, paceMs: 0 });
    expect(watch.state()).toEqual({ ready: false, retired: [] });
    await watch.catchUp(1);
    expect(watch.state().ready).toBe(false);
    await watch.catchUp();
    expect(watch.state()).toEqual({ ready: true, retired: ["1"] });
    head = 10_000n;
    expect(watch.state().ready).toBe(true);
    await watch.catchUp(1);
    expect(watch.state().ready).toBe(false);
  });
});
