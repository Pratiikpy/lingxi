import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { createIndexer } from "../src/indexer";
import { createCircuitCounter } from "../src/circuits";

const REG = "0x00000000000000000000000000000000000000c3" as Address;
const PROC = "0x00000000000000000000000000000000000000d4" as Address;
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const RELAYER = "0x00000000000000000000000000000000000000ee";
const ZERO = "0x0000000000000000000000000000000000000000";
const NOW = 1_800_000_000;
const DAY = 86_400;

/** Each block that carries an event, and its time: two older than a week, the rest within it. */
const TIME: Record<number, number> = { 1000: NOW - 10 * DAY, 1500: NOW - 8 * DAY, 2000: NOW - 2 * DAY, 2500: NOW - DAY, 2600: NOW - DAY + 60, 2700: NOW - DAY / 2 };

function registryChain() {
  const logs = [
    { block: 1000, tx: "0x01", eventName: "Hatched", args: { petId: 1n, to: A, line: 0, brainId: 1n, state: 0n } },
    { block: 1500, tx: "0x02", eventName: "Checkpoint", args: { petId: 1n, day: 2, state: 0n, logHash: "0x00" } },
    { block: 2000, tx: "0x03", eventName: "Hatched", args: { petId: 2n, to: B, line: 1, brainId: 2n, state: 0n } },
    { block: 2500, tx: "0x04", eventName: "Bred", args: { petId: 3n, parentA: 1n, parentB: 2n } },
    { block: 2500, tx: "0x04", eventName: "Hatched", args: { petId: 3n, to: A, line: 2, brainId: 3n, state: 0n } },
    { block: 2600, tx: "0x05", eventName: "Checkpoint", args: { petId: 1n, day: 9, state: 0n, logHash: "0x00" } },
    { block: 2700, tx: "0x06", eventName: "Checkpoint", args: { petId: 2n, day: 1, state: 0n, logHash: "0x00" } },
  ];
  const senders: Record<string, string> = { "0x01": A, "0x03": RELAYER, "0x04": A };
  const asked: string[] = [];
  return {
    asked,
    client: {
      getBlockNumber: async () => 3000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => logs.filter((l) => l.block >= Number(fromBlock) && l.block <= Number(toBlock)).map((l) => ({ ...l, blockNumber: BigInt(l.block), transactionHash: l.tx })),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(TIME[Number(blockNumber)] ?? NOW) }),
      getTransaction: async ({ hash }: { hash: string }) => (asked.push(hash), { from: senders[hash]! }),
    } as unknown as PublicClient,
  };
}

describe("activity and who kept each pet (H10)", () => {
  it("counts the last 7 days from the chain's own times", async () => {
    const c = registryChain();
    const ix = createIndexer({ rpc: "", registry: REG, fromBlock: 900, client: c.client, paceMs: 0 });
    await ix.catchUp();
    // pet 2 hatched 2 days ago, pet 3 born a day ago, two saves within the week (pet 1's first save is 8 days old)
    expect(ix.activity(NOW - 7 * DAY)).toEqual({ hatched: 1, children: 1, saves: 2, petsSaved: 2, hatchers: 2 });
  });

  it("tells a pet kept by its owner's own wallet from one kept for them by Lingxi's relayer", async () => {
    const c = registryChain();
    const ix = createIndexer({ rpc: "", registry: REG, fromBlock: 900, client: c.client, paceMs: 0 });
    await ix.catchUp();
    expect(ix.keepers([RELAYER])).toEqual({ own: 2, sponsored: 1, other: 0 });
    // a sender that is neither the owner nor the relayer is counted apart, never as the owner's
    expect(ix.keepers([])).toEqual({ own: 2, sponsored: 0, other: 1 });
  });

  it("fills in who sent the hatch for pets indexed before it was recorded, without reading the chain again", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "ix-")), "history.json");
    const c = registryChain();
    writeFileSync(store, JSON.stringify({ v: 2, next: 3001, pets: { "1": { hatched: { block: 1000, tx: "0x01", line: 0, brainId: "1", state: "0", to: A }, children: [], saves: [], brains: [] } }, times: { "1000": NOW - 10 * DAY } }));
    const ix = createIndexer({ rpc: "", registry: REG, fromBlock: 900, store, client: c.client, paceMs: 0 });
    await ix.catchUp();
    expect(c.asked).toEqual(["0x01"]);
    expect(ix.keepers([RELAYER])).toEqual({ own: 1, sponsored: 0, other: 0 });
  });
});

describe("the team's own pets, told apart (C2)", () => {
  it("counts the pets, saves and hatching wallets that belong to the team's wallets, all time and this week", async () => {
    const c = registryChain();
    const ix = createIndexer({ rpc: "", registry: REG, fromBlock: 900, client: c.client, paceMs: 0 });
    await ix.catchUp();
    // A (the team here) owns pets 1 and 3; B owns pet 2
    expect(ix.byTeam([A], NOW - 7 * DAY)).toEqual({
      all: { hatched: 1, children: 1, saves: 2, hatchers: 1 },
      week: { hatched: 0, children: 1, saves: 1, petsSaved: 1, hatchers: 1 },
    });
    expect(ix.byTeam([], NOW - 7 * DAY)).toEqual({ all: { hatched: 0, children: 0, saves: 0, hatchers: 0 }, week: { hatched: 0, children: 0, saves: 0, petsSaved: 0, hatchers: 0 } });
  });
});

describe("circuits Lingxi has taped out (H10)", () => {
  it("dates each circuit by its mint and counts those of the last 7 days; transfers are not new circuits", async () => {
    const mints = [
      { block: 1000, from: ZERO, id: 1n },
      { block: 2000, from: ZERO, id: 2n },
      { block: 2500, from: ZERO, id: 3n },
      { block: 2600, from: A, id: 1n },
    ];
    const client = {
      getBlockNumber: async () => 3000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        mints.filter((m) => m.block >= Number(fromBlock) && m.block <= Number(toBlock)).map((m) => ({ blockNumber: BigInt(m.block), args: { from: m.from, to: B, tokenId: m.id } })),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(TIME[Number(blockNumber)] ?? NOW) }),
    } as unknown as PublicClient;
    const cc = createCircuitCounter({ rpc: "", processor: PROC, fromBlock: 900, client, paceMs: 0 });
    await cc.catchUp();
    expect(cc.totals(NOW - 7 * DAY)).toEqual({ minted: 3, since: 2, indexedTo: 3000 });
  });

  it("counts the week's circuits from the processor's own count, without waiting for the walk (C7)", async () => {
    // one block a second; circuits 1 to 5 before block 400, 6 to 9 after it; nextId is the latest id at each block
    const T0 = NOW - 1_000;
    const client = {
      getBlockNumber: async () => 1_000n,
      getLogs: async () => [],
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(T0 + Number(blockNumber)) }),
      readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
        if (functionName !== "nextId") throw new Error(functionName);
        const b = Number(blockNumber ?? 1_000n);
        return BigInt(b < 400 ? 5 : b < 700 ? 7 : 9);
      },
    } as unknown as PublicClient;
    const cc = createCircuitCounter({ rpc: "", processor: PROC, fromBlock: 100, client, paceMs: 0 });
    // since block 400's time: circuits 6 to 9 are this window's
    expect(await cc.week(T0 + 400)).toBe(4);
    expect(await cc.week(T0 + 700)).toBe(2);
    // a window opening before the processor existed counts every circuit
    expect(await cc.week(T0 + 50)).toBe(9);
  });

  it("counts only the week's circuits when its walk starts after the week began (P3a)", async () => {
    // the processor was deployed at block 100; the walk starts at block 800 (an operator's LINGXI_PROCESSOR_FROM, or a
    // fork's own block); the week opens at block 400. Circuits 1 to 5 came before it: they are not the week's
    const T0 = NOW - 1_000;
    const client = {
      getBlockNumber: async () => 1_000n,
      getLogs: async () => [],
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(T0 + Number(blockNumber)) }),
      readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
        if (functionName !== "nextId") throw new Error(functionName);
        const b = Number(blockNumber ?? 1_000n);
        if (b < 100) throw new Error("no contract at this block");
        return BigInt(b < 400 ? 5 : b < 700 ? 7 : 9);
      },
    } as unknown as PublicClient;
    const cc = createCircuitCounter({ rpc: "", processor: PROC, fromBlock: 800, deployBlock: 100, client, paceMs: 0 });
    expect(await cc.week(T0 + 400)).toBe(4);
    expect(await cc.week(T0 + 900)).toBe(0);
    // the deployment inside the window: every circuit is the week's
    expect(await cc.week(T0 + 50)).toBe(9);
  });

  it("reads again from the deploy block when its saved place belongs to another start or processor", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "cc-")), "circuits.json");
    const mints = [{ block: 1000, id: 1n }, { block: 2000, id: 2n }];
    const client = {
      getBlockNumber: async () => 3000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        mints.filter((m) => m.block >= Number(fromBlock) && m.block <= Number(toBlock)).map((m) => ({ blockNumber: BigInt(m.block), args: { from: ZERO, to: B, tokenId: m.id } })),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(TIME[Number(blockNumber)] ?? NOW) }),
    } as unknown as PublicClient;
    // a place saved by a walk that started later (a fork of the chain): its mints before that start were never read
    writeFileSync(store, JSON.stringify({ processor: PROC, from: 2500, next: 2601, mints: [] }));
    const fresh = createCircuitCounter({ rpc: "", processor: PROC, fromBlock: 900, store, client, paceMs: 0 });
    await fresh.catchUp();
    expect(fresh.totals(0).minted).toBe(2);
    // and one saved for another processor
    writeFileSync(store, JSON.stringify({ processor: B, from: 900, next: 3001, mints: [] }));
    const other = createCircuitCounter({ rpc: "", processor: PROC, fromBlock: 900, store, client, paceMs: 0 });
    await other.catchUp();
    expect(other.totals(0).minted).toBe(2);
    // its own place is kept: nothing is read twice
    const again = createCircuitCounter({ rpc: "", processor: PROC, fromBlock: 900, store, client, paceMs: 0 });
    expect(again.totals(0)).toEqual({ minted: 2, since: 2, indexedTo: 3000 });
  });
});
