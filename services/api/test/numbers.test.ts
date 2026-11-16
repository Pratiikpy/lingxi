import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { createSalesCounter, readNumbers, withNumbers } from "../src/numbers";

const OKB = "0x00000000000000000000000000000000000000a1" as const;
const BEM = "0x00000000000000000000000000000000000000b2" as const;
const REG = "0x00000000000000000000000000000000000000c3" as const;
const BREEDER = "0x00000000000000000000000000000000000000d4" as const;
const GIFT = "0x00000000000000000000000000000000000000e5" as const;

/** A chain with a few sales at known blocks, and fixed contract totals. */
function fakeChain(head: number) {
  const sales: Record<string, Array<{ block: number; quantity: number; paid: bigint }>> = {
    [OKB]: [
      { block: 1_005, quantity: 2, paid: 2_000_000_000_000_000n },
      { block: 1_250, quantity: 1, paid: 3_000_000_000_000_000n },
    ],
    [BEM]: [
      { block: 2_010, quantity: 3, paid: 30_000_000n },
      { block: 2_099, quantity: 1, paid: 50_000_000n },
      { block: 2_100, quantity: 1, paid: 50_000_000n },
    ],
  };
  const calls: Array<[number, number]> = [];
  const client = {
    getBlockNumber: async () => BigInt(head),
    getLogs: async ({ address, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      calls.push([Number(fromBlock), Number(toBlock)]);
      if (Number(toBlock) - Number(fromBlock) >= 100) throw new Error("block range greater than 100 max");
      return (sales[address] ?? []).filter((s) => s.block >= Number(fromBlock) && s.block <= Number(toBlock)).map((s) => ({ args: { quantity: s.quantity, paid: s.paid }, blockNumber: BigInt(s.block) }));
    },
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === "nextPetId") return 12n;
      if (functionName === "totalBurned") return address === BEM ? 4_200_000n : address === BREEDER ? 10_000_000n : 0n;
      if (functionName === "total") return 7n;
      throw new Error("unexpected read");
    },
  } as unknown as PublicClient;
  return { client, calls };
}

const counts = () => ({ hatched: 9, children: 2, saves: 40, savedSince: 3, hatchers: 5 });

describe("live numbers", () => {
  it("counts every sale on both markets in windows of at most 100 blocks, and resumes from its file", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "sales-")), "sales.json");
    const { client, calls } = fakeChain(2_150);
    const markets = [
      { address: OKB, fromBlock: 1_000 },
      { address: BEM, fromBlock: 2_000 },
    ];
    const s = createSalesCounter({ rpc: "", markets, store, client, paceMs: 0 });
    await s.catchUp();
    expect(s.totals(OKB)).toEqual({ copies: 3, paid: "5000000000000000", sales: 2 });
    expect(s.totals(BEM)).toEqual({ copies: 5, paid: "130000000", sales: 3 });
    expect(calls.every(([a, b]) => b - a < 100)).toBe(true);
    expect(s.head(BEM)).toBe(2_150);
    // a restart reads its place back and counts nothing twice
    const again = createSalesCounter({ rpc: "", markets, store, client: fakeChain(2_150).client, paceMs: 0 });
    await again.catchUp();
    expect(again.totals(BEM)).toEqual({ copies: 5, paid: "130000000", sales: 3 });
  });

  it("reads contract totals from the contracts and links every source", async () => {
    const { client } = fakeChain(2_150);
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }, { address: BEM, fromBlock: 2_000 }], client, paceMs: 0 });
    await sales.catchUp();
    const n = await readNumbers({ pub: client, counts, petsIndexedTo: () => 2_140, sales, contracts: { registry: REG, marketOkb: OKB, marketBem: BEM, breeder: BREEDER, gift: GIFT }, explorer: "https://x" }, 1_800_000_000_000);
    expect(n.pets).toEqual({ hatched: 9, children: 2, daysSaved: 40, savedLast24h: 3, hatchers: 5, nextPetId: 12, indexedTo: 2_140 });
    expect(n.burned).toEqual({ market: "4200000", breeding: "10000000", total: "14200000" });
    expect(n.pins).toBe(7);
    expect(n.outfits.bem?.copies).toBe(5);
    expect(n.contracts.marketBem).toEqual({ address: BEM, url: `https://x/address/${BEM}` });
  });

  it("before the BEM contracts exist, their numbers are absent rather than invented", async () => {
    const { client } = fakeChain(1_300);
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    await sales.catchUp();
    const n = await readNumbers({ pub: client, counts, petsIndexedTo: () => 1_290, sales, contracts: { registry: REG, marketOkb: OKB }, explorer: "https://x" });
    expect(n.outfits.bem).toBeNull();
    expect(n.pins).toBeNull();
    expect(n.burned.total).toBe("0");
  });

  it("serves the numbers to any origin, cached for a minute", async () => {
    const { client } = fakeChain(1_300);
    let reads = 0;
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    const app = withNumbers(new Hono(), { pub: client, counts: (s) => (reads++, counts()), petsIndexedTo: () => 1, sales, contracts: { registry: REG, marketOkb: OKB }, explorer: "https://x" });
    const a = await app.request("/api/numbers");
    expect(a.status).toBe(200);
    expect(a.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await a.json()) as { ok: boolean }).ok).toBe(true);
    await app.request("/api/numbers");
    expect(reads).toBe(1);
  });
});
