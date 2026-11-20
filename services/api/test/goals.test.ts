import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { GOALS, type GoalDef, SETTLED_DAYS, walletCap } from "@lingxi/world";
import { createGoalLedger, reportGoals, withGoals } from "../src/goals";
import { SAVES_PER_WALLET_DAY } from "@lingxi/world";

const REG = "0x00000000000000000000000000000000000000c3";
const BREEDER = "0x00000000000000000000000000000000000000d4";
const MARKET = "0x00000000000000000000000000000000000000e5";
const OTHER = "0x00000000000000000000000000000000000000f6";
const ALICE = "0x000000000000000000000000000000000000a11c";
const BOB = "0x0000000000000000000000000000000000000b0b";
const ZERO = "0x0000000000000000000000000000000000000000";

type Log = { address: string; eventName: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: string };
const at = (address: string, block: number, logIndex: number, eventName: string, args: Record<string, unknown>): Log => ({ address, eventName, args, blockNumber: BigInt(block), logIndex, transactionHash: `0x${block.toString(16).padStart(64, "0")}` });

/**
 * Pet 1 hatched for Alice, saved twice (one day saved again, which counts once), then given to Bob, who saves its
 * third day, which settles it; a child of Bob's, never saved; a pet hatched and left; burns on both burners.
 */
const LOGS: Log[] = [
  at(REG, 1_010, 0, "Transfer", { from: ZERO, to: ALICE, tokenId: 1n }),
  at(REG, 1_010, 1, "Hatched", { petId: 1n, to: ALICE }),
  at(REG, 1_050, 0, "Checkpoint", { petId: 1n, day: 1 }),
  at(REG, 1_150, 0, "Checkpoint", { petId: 1n, day: 2 }),
  at(REG, 1_160, 0, "Checkpoint", { petId: 1n, day: 2 }), // the same day saved again: counts once
  at(REG, 1_170, 0, "Transfer", { from: ZERO, to: OTHER, tokenId: 9n }),
  at(REG, 1_170, 1, "Hatched", { petId: 9n, to: OTHER }), // hatched and never kept: never a new pet for a goal
  at(REG, 1_200, 0, "Transfer", { from: ALICE, to: BOB, tokenId: 1n }),
  at(REG, 1_210, 0, "Checkpoint", { petId: 1n, day: 3 }),
  at(REG, 1_300, 3, "Bred", { petId: 2n, parentA: 1n, parentB: 1n }),
  at(REG, 1_300, 1, "Transfer", { from: ZERO, to: BOB, tokenId: 2n }), // given out of order on purpose: the mint comes first
  at(REG, 1_300, 2, "Hatched", { petId: 2n, to: BOB }),
  at(BREEDER, 1_300, 0, "Burned", { payer: BOB, amount: 10_000_000n }),
  at(MARKET, 1_320, 0, "Burned", { payer: ALICE, amount: 3_000_000n }),
  at(OTHER, 1_330, 0, "Burned", { payer: ALICE, amount: 9_000_000_000n }), // not one of ours: never counted
];

function fakeChain(head: number) {
  const ranges: Array<[number, number]> = [];
  const client = {
    getBlockNumber: async () => BigInt(head),
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber * 10n }),
    getLogs: async ({ address, fromBlock, toBlock }: { address: string[]; fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([Number(fromBlock), Number(toBlock)]);
      if (Number(toBlock) - Number(fromBlock) >= 100) throw new Error("block range greater than 100 max");
      const want = new Set(address.map((a) => a.toLowerCase()));
      return LOGS.filter((l) => want.has(l.address) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
  } as unknown as PublicClient;
  return { client, ranges };
}

const goal = (id: string, metric: GoalDef["metric"], target: number, start = 0, end = 1e12): GoalDef => ({ ...GOALS[0]!, id, metric, target, start, end });

describe("community goal ledger", () => {
  it("credits each event to the right wallet, following the pet through a transfer", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "goals-")), "goals.json");
    const { client, ranges } = fakeChain(1_400);
    const l = createGoalLedger({ rpc: "", registry: REG, burners: [BREEDER, MARKET], fromBlock: 1_000, store, client, paceMs: 0 });
    await l.catchUp();
    expect(ranges.every(([a, b]) => b - a < 100)).toBe(true);
    const sum = (m: string, w: string) => l.entries().filter((e) => e.m === m && e.w === w).reduce((s, e) => s + e.n, 0);
    expect([sum("saves", ALICE), sum("saves", BOB)]).toEqual([2, 1]);
    // pet 1 counts for Alice, the wallet it was hatched for, when its third day is saved (Bob's save at block 1_210)
    expect([sum("hatched", ALICE), sum("hatched", BOB), sum("hatched", OTHER)]).toEqual([1, 0, 0]);
    expect(l.entries().find((e) => e.m === "hatched")!.b).toBe(1_210);
    expect(sum("children", BOB)).toBe(1);
    expect([sum("burned", BOB), sum("burned", ALICE)]).toEqual([10_000_000, 3_000_000]);
    expect(l.entries().every((e) => e.t === e.b * 10)).toBe(true);
    expect(l.head()).toBe(1_400);
    // a restart resumes from the file and reads nothing twice
    const again = createGoalLedger({ rpc: "", registry: REG, burners: [BREEDER, MARKET], fromBlock: 1_000, store, client: fakeChain(1_400).client, paceMs: 0 });
    expect(await again.catchUp()).toBe(0);
    expect(again.entries()).toHaveLength(l.entries().length);
  });

  it("counts only inside a goal's window, ranks contributors with shares, and adds up the asked-for wallets", async () => {
    const { client } = fakeChain(1_400);
    const l = createGoalLedger({ rpc: "", registry: REG, burners: [BREEDER, MARKET], fromBlock: 1_000, client, paceMs: 0 });
    await l.catchUp();
    // a window from block 1_100 to block 1_250 (block time is block × 10): Alice's second save and Bob's first
    const [saves, burned] = reportGoals(l.entries(), [goal("g1", "saves", 4, 11_000, 12_500), goal("g4", "burned", 26_000_000)], 20_000, [BOB]);
    expect(saves).toMatchObject({ total: 2, contributors: 2, tiers: [25, 50], mine: 1, state: "ended" });
    expect(saves!.top.map((t) => t.share)).toEqual([0.5, 0.5]);
    // Bob burned 10,000,000 but one wallet counts for at most a fifth of the 26,000,000 target
    expect(burned).toMatchObject({ total: 8_200_000, cap: 5_200_000, tiers: [25], mine: 5_200_000, state: "open" });
    expect(burned!.top[0]).toMatchObject({ wallet: BOB, n: 5_200_000 });
    expect(burned!.top[0]!.share).toBeCloseTo(5.2 / 8.2, 12);
  });

  it("serves the standing, refusing a malformed wallet", async () => {
    const { client } = fakeChain(1_400);
    const l = createGoalLedger({ rpc: "", registry: REG, burners: [BREEDER, MARKET], fromBlock: 1_000, client, paceMs: 0 });
    await l.catchUp();
    const app = withGoals(new Hono(), l, [goal("g2", "hatched", 4)]);
    const res = await app.request(`/api/goals?wallet=${ALICE},${BOB.toUpperCase().replace("0X", "0x")}`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { ok: boolean; indexedTo: number; goals: Array<{ total: number; mine: number; tiers: number[] }> };
    expect(body).toMatchObject({ ok: true, indexedTo: 1_400 });
    expect(body.goals[0]).toMatchObject({ total: 1, mine: 1, tiers: [25] });
    expect((await app.request("/api/goals?wallet=0x123")).status).toBe(400);
    expect((await app.request(`/api/goals?wallet=${Array(9).fill(ALICE).join(",")}`)).status).toBe(400);
  });

  it("no wallet finishes a goal alone: each counts for at most a fifth of the target", () => {
    const g = goal("g1", "saves", 10);
    expect(walletCap(g)).toBe(2);
    const e = (w: string, n: number) => Array.from({ length: n }, (_, i) => ({ m: "saves" as const, w, n: 1, b: i, t: i, tx: "0x" }));
    const [r] = reportGoals([...e(ALICE, 9), ...e(BOB, 1)], [g], 100, [ALICE]);
    expect(r).toMatchObject({ total: 3, contributors: 2, mine: 2, tiers: [25] });
    expect(r!.top[0]).toMatchObject({ wallet: ALICE, n: 2 });
    // a small target still lets everyone count once
    expect(walletCap(goal("g3", "children", 3))).toBe(1);
  });

  it("a wallet's saves count for at most as many pets as a player keeps, each day (A64)", () => {
    const g = goal("g1", "saves", 1_000);
    const DAY = 86_400;
    // twelve pets saved on day one and three on day two, all by one wallet
    const saves = [...Array.from({ length: 12 }, (_, i) => ({ m: "saves" as const, w: ALICE, n: 1, b: i, t: DAY + i, tx: "0x" })), ...Array.from({ length: 3 }, (_, i) => ({ m: "saves" as const, w: ALICE, n: 1, b: 100 + i, t: 2 * DAY + i, tx: "0x" }))];
    const [r] = reportGoals(saves, [g], 3 * DAY, [ALICE]);
    expect(SAVES_PER_WALLET_DAY).toBe(8);
    expect(r).toMatchObject({ total: 11, mine: 11 });
  });

  it("a farm of fresh pets does not move the new-pets goal; only pets kept for days do", async () => {
    const FARM = "0x000000000000000000000000000000000000fa12";
    const logs: Log[] = [];
    for (let id = 100; id < 140; id++) {
      logs.push(at(REG, 2_000 + id, 0, "Transfer", { from: ZERO, to: FARM, tokenId: BigInt(id) }), at(REG, 2_000 + id, 1, "Hatched", { petId: BigInt(id), to: FARM }));
      // each saved once, and the same day again: never settled
      logs.push(at(REG, 2_200 + id, 0, "Checkpoint", { petId: BigInt(id), day: 1 }), at(REG, 2_300 + id, 0, "Checkpoint", { petId: BigInt(id), day: 1 }));
    }
    const client = {
      getBlockNumber: async () => 2_600n,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber * 10n }),
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock),
    } as unknown as PublicClient;
    const l = createGoalLedger({ rpc: "", registry: REG, burners: [], fromBlock: 2_000, client, paceMs: 0 });
    await l.catchUp();
    const [hatched, saves] = reportGoals(l.entries(), [goal("g2", "hatched", 40), goal("g1", "saves", 150)], 1e9);
    expect(hatched!.total).toBe(0);
    // forty pets each saved on the same day: one wallet's saves count for as many pets as a player keeps (A64)
    expect(saves!.total).toBe(SAVES_PER_WALLET_DAY);
    expect(SAVES_PER_WALLET_DAY).toBeLessThan(walletCap(goal("g1", "saves", 150)));
    expect(SETTLED_DAYS).toBe(3);
  });
});
