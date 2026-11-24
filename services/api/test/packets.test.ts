import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createGoalLedger } from "../src/goals";
import { createIndexer } from "../src/indexer";
import { createSalesCounter } from "../src/numbers";
import { createPacketIndex } from "../src/packets";

const ADDR = "0x7acceb7ab1cff102fe2660f511e88d42010e806b" as const;
const DAY = 86_400;

interface FakeLog {
  eventName: "Created" | "Claimed";
  blockNumber: bigint;
  transactionHash: string;
  args: Record<string, unknown>;
}

/**
 * A node with X Layer's real limit: any log query over more than 100 blocks is refused, as the public nodes do
 * ("block range greater than 100 max"). It records every range it was asked for.
 */
function strictNode(head: number, logs: FakeLog[] = []) {
  const asked: Array<[number, number]> = [];
  const client = {
    getBlockNumber: async () => BigInt(head),
    getBlock: async () => ({ timestamp: 1_795_000_000n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      const from = Number(fromBlock);
      const to = Number(toBlock);
      asked.push([from, to]);
      if (to - from + 1 > 100) throw new Error("block range greater than 100 max");
      return logs.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to);
    },
    readContract: async () => 0n,
  };
  return { client: client as unknown as PublicClient, asked };
}

const created = (id: number, block: number, expiry: number, count = 3): FakeLog => ({
  eventName: "Created",
  blockNumber: BigInt(block),
  transactionHash: `0xc${id}${block}`,
  args: {
    id: BigInt(id),
    sender: "0xS",
    token: "0xT",
    total: 300n,
    count,
    lucky: false,
    petOwnersOnly: false,
    expiry: BigInt(expiry),
  },
});
const claimed = (id: number, block: number, index: number, who = `0xA${index}`): FakeLog => ({
  eventName: "Claimed",
  blockNumber: BigInt(block),
  transactionHash: `0xd${id}${block}${index}`,
  args: { id: BigInt(id), claimer: who, amount: 100n, index, sealInput: 7, sealOutput: 1 },
});

describe("the red packet claims index (A1)", () => {
  it("reads to the head in windows of at most 100 blocks and lists each packet's claims in order", async () => {
    const { client, asked } = strictNode(1_950, [
      created(1, 1_010, 2_000_000_000),
      claimed(1, 1_500, 1),
      claimed(1, 1_420, 0),
      created(2, 1_900, 2_000_000_000),
      claimed(2, 1_949, 0),
    ]);
    const index = createPacketIndex({ address: ADDR, fromBlock: 1_000, client, paceMs: 0 });
    expect(await index.catchUp()).toBe(5);
    expect(asked.every(([f, t]) => t - f + 1 <= 100)).toBe(true);
    expect(index.head()).toBe(1_950);
    const one = index.claimsOf("1")!;
    expect(one.claims.map((c) => c.index)).toEqual([0, 1]);
    expect(one.claims[0]).toEqual({
      claimer: "0xA0",
      amount: "100",
      index: 0,
      sealInput: 7,
      sealOutput: 1,
      tx: "0xd114200",
      block: 1_420,
    });
    expect(one.created?.count).toBe(3);
    expect(index.claimsOf("9")).toBeNull();
  });

  it("keeps its place across a restart and never lists a claim twice", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "packets-")), "packets.json");
    const logs = [created(1, 1_010, 2_000_000_000), claimed(1, 1_050, 0)];
    const first = createPacketIndex({
      address: ADDR,
      fromBlock: 1_000,
      client: strictNode(1_060, logs).client,
      paceMs: 0,
      store,
    });
    await first.catchUp();
    // the next run starts where the last one stopped, and reading a window again changes nothing
    const again = strictNode(1_200, [...logs, claimed(1, 1_150, 1)]);
    const second = createPacketIndex({ address: ADDR, fromBlock: 1_000, client: again.client, paceMs: 0, store });
    await second.catchUp();
    expect(again.asked[0]![0]).toBe(1_061);
    expect(second.claimsOf("1")!.claims.map((c) => c.index)).toEqual([0, 1]);
  });

  it("forgets a packet 30 days after it closes, never one still open, and keeps within its claim budget", async () => {
    const t = 1_800_000_000;
    const logs = [
      created(1, 1_010, t - 40 * DAY),
      claimed(1, 1_011, 0),
      created(2, 1_020, t - 5 * DAY),
      claimed(2, 1_021, 0),
      claimed(2, 1_022, 1),
      created(3, 1_030, t + DAY),
      claimed(3, 1_031, 0),
      claimed(3, 1_032, 1),
    ];
    const index = createPacketIndex({
      address: ADDR,
      fromBlock: 1_000,
      client: strictNode(1_040, logs).client,
      paceMs: 0,
      now: () => t,
      maxClaims: 3,
    });
    await index.catchUp();
    // 1 closed 40 days ago: forgotten. 2 closed 5 days ago and 3 still open: kept, but four claims exceed a budget of
    // three, so the closed one goes; the open one is never dropped
    expect(index.claimsOf("1")).toBeNull();
    expect(index.claimsOf("2")).toBeNull();
    expect(index.claimsOf("3")!.claims).toHaveLength(2);
    expect(index.size()).toEqual({ packets: 1, claims: 2 });
  });

  it("forgets a closed packet's claims 30 days after it closes, however much room is left", async () => {
    const t = 1_800_000_000;
    const logs = [
      created(1, 1_010, t - 31 * DAY),
      claimed(1, 1_011, 0),
      created(2, 1_020, t - 29 * DAY),
      claimed(2, 1_021, 0),
    ];
    const index = createPacketIndex({
      address: ADDR,
      fromBlock: 1_000,
      client: strictNode(1_040, logs).client,
      paceMs: 0,
      now: () => t,
    });
    await index.catchUp();
    expect(index.claimsOf("1")).toBeNull();
    expect(index.claimsOf("2")!.claims).toHaveLength(1);
  });
});

describe("every log read stays within the public nodes' 100-block limit (A1)", () => {
  it("the history indexer, the goals ledger and the sales counter each catch up 1,000 blocks without a refusal", async () => {
    const histories = strictNode(2_000);
    await createIndexer({ rpc: "", registry: ADDR, fromBlock: 1_000, client: histories.client, paceMs: 0 }).catchUp();
    const goals = strictNode(2_000);
    await createGoalLedger({
      rpc: "",
      registry: ADDR,
      burners: [],
      fromBlock: 1_000,
      client: goals.client,
      paceMs: 0,
    }).catchUp();
    const sales = strictNode(2_000);
    await createSalesCounter({
      rpc: "",
      markets: [{ address: ADDR, fromBlock: 1_000 }],
      client: sales.client,
      paceMs: 0,
    }).catchUp();
    for (const [name, node] of Object.entries({ histories, goals, sales })) {
      expect(node.asked.length, name).toBeGreaterThanOrEqual(10);
      expect(
        node.asked.every(([f, t]) => t - f + 1 <= 100),
        name,
      ).toBe(true);
    }
  });
});

describe("the claims route (A1)", () => {
  it("answers a packet's claims with the block they are read to, and says when a packet is not known yet", async () => {
    const { Hono } = await import("hono");
    const { withPackets } = await import("../src/server");
    const { client } = strictNode(1_100, [created(5, 1_010, 2_000_000_000), claimed(5, 1_020, 0)]);
    const index = createPacketIndex({ address: ADDR, fromBlock: 1_000, client, paceMs: 0 });
    await index.catchUp();
    const app = withPackets(new Hono(), index);
    const ok = (await (await app.request("/api/packets/5/claims")).json()) as {
      ok: boolean;
      indexedTo: number;
      claims: unknown[];
    };
    expect(ok).toMatchObject({ ok: true, indexedTo: 1_100 });
    expect(ok.claims).toHaveLength(1);
    expect(await (await app.request("/api/packets/6/claims")).json()).toEqual({
      ok: false,
      reason: "unknown",
      indexedTo: 1_100,
    });
    expect((await app.request("/api/packets/x/claims")).status).toBe(400);
  });
});
