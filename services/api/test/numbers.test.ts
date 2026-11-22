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
const SHOP = "0x0000000000000000000000000000000000000a11";
const EXTRAS = "0x0000000000000000000000000000000000000e11";

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
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "nextPetId") return 12n;
      if (functionName === "totalBurned") return address === BEM ? 4_200_000n : address === BREEDER ? 10_000_000n : address === SHOP ? 15_000_000n : address === EXTRAS ? 25_000_000n : 0n;
      if (functionName === "total") return 7n;
      if (functionName === "sold" && address === EXTRAS) return [2n, 1n, 2n][Number(args?.[0])]!;
      throw new Error("unexpected read");
    },
  } as unknown as PublicClient;
  return { client, calls };
}

const counts = () => ({ hatched: 9, children: 2, saves: 40, savedSince: 3, hatchers: 5 });

const PROJECT = "0x00000000000000000000000000000000000000f6" as const;

/** The OKB market with fee changes among its sales: 3% at first, 5% from block 1,100, a stranger's treasury from 1,300. */
function feeChain() {
  const logs = [
    { block: 1_005, eventName: "Minted", args: { quantity: 2, paid: 2_000_000_000_000_000n } },
    { block: 1_100, eventName: "FeeChanged", args: { feeBps: 500, treasury: PROJECT } },
    { block: 1_250, eventName: "Sold", args: { quantity: 1, paid: 3_000_000_000_000_000n } },
    { block: 1_300, eventName: "FeeChanged", args: { feeBps: 500, treasury: "0x00000000000000000000000000000000000000aa" } },
    { block: 1_350, eventName: "Sold", args: { quantity: 1, paid: 1_000_000_000_000_000n } },
  ];
  return {
    getBlockNumber: async () => 1_400n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs.filter((l) => l.block >= Number(fromBlock) && l.block <= Number(toBlock)).map((l, i) => ({ ...l, blockNumber: BigInt(l.block), logIndex: i })),
  } as unknown as PublicClient;
}

describe("live numbers", () => {
  it("counts what the OKB market paid the project: each sale's fee at the rate in force, only while the treasury is the project's (H8)", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "earn-")), "sales.json");
    const s = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }], store, client: feeChain(), paceMs: 0 });
    await s.catchUp();
    // 3% of 0.002 OKB, then 5% of 0.003 OKB; the last sale's fee went to someone else's treasury
    expect(s.totals(OKB)).toEqual({ copies: 4, paid: "6000000000000000", sales: 3 });
    expect(s.earned(OKB)).toEqual({ okb: (60_000_000_000_000n + 150_000_000_000_000n).toString(), feeBps: 500, treasury: "0x00000000000000000000000000000000000000aa", toProject: false });
    // a restart resumes with the rate and treasury it had reached
    const again = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }], store, client: feeChain(), paceMs: 0 });
    await again.catchUp();
    expect(again.earned(OKB)).toEqual(s.earned(OKB));
  });

  it("a file counted before earnings were counted is counted again from the market's first block", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "earn-")), "sales.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(store, JSON.stringify({ next: { [OKB]: 1_401 }, totals: { [OKB]: { copies: 4, paid: "6000000000000000", sales: 3 } } }));
    const s = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }], store, client: feeChain(), paceMs: 0 });
    await s.catchUp();
    expect(s.earned(OKB)?.okb).toBe("210000000000000");
    expect(s.totals(OKB).sales).toBe(3);
  });


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
    const n = await readNumbers({ pub: client, counts, petsIndexedTo: () => 2_140, sales, contracts: { registry: REG, marketOkb: OKB, marketBem: BEM, breeder: BREEDER, gift: GIFT, itemShop: SHOP, extras: EXTRAS }, explorer: "https://x" }, 1_800_000_000_000);
    expect(n.head).toBe(2_150);
    expect(n.pets).toEqual({ hatched: 9, children: 2, daysSaved: 40, savedLast24h: 3, hatchers: 5, nextPetId: 12, indexedTo: 2_140 });
    // the item shop's whole price is burned and counts in the total (plan 4.6), and so do the paid extras (plan 4.9)
    expect(n.burned).toEqual({ market: "4200000", breeding: "10000000", shop: "15000000", adoption: "0", extras: "25000000", total: "54200000" });
    expect(n.extras).toEqual({ room: 2, looks: 1, colours: 2 });
    expect(n.contracts.extras).toEqual({ address: EXTRAS, url: `https://x/address/${EXTRAS}` });
    expect(n.contracts.itemShop).toEqual({ address: SHOP, url: `https://x/address/${SHOP}` });
    expect(n.pins).toBe(7);
    expect(n.outfits.bem?.copies).toBe(5);
    expect(n.contracts.marketBem).toEqual({ address: BEM, url: `https://x/address/${BEM}` });
  });

  it("serves the project's earnings beside the burns, with the rate and the wallet they go to (H8)", async () => {
    const { client } = fakeChain(2_150);
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }, { address: BEM, fromBlock: 2_000 }], client, paceMs: 0 });
    await sales.catchUp();
    const n = await readNumbers({ pub: client, counts, petsIndexedTo: () => 2_140, sales, contracts: { registry: REG, marketOkb: OKB, marketBem: BEM }, explorer: "https://x" });
    // 3% of the 0.005 OKB the two sales paid
    expect(n.earned).toEqual({ okb: "150000000000000", feeBps: 300, treasury: PROJECT, toProject: true, indexedTo: 2_150 });
    const none = await readNumbers({ pub: client, counts, petsIndexedTo: () => 2_140, sales: createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 }), contracts: { registry: REG, marketOkb: OKB }, explorer: "https://x" });
    expect(none.earned).toBeNull();
  });

  it("before the BEM contracts exist, their numbers are absent rather than invented", async () => {
    const { client } = fakeChain(1_300);
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    await sales.catchUp();
    const n = await readNumbers({ pub: client, counts, petsIndexedTo: () => 1_290, sales, contracts: { registry: REG, marketOkb: OKB }, explorer: "https://x" });
    expect(n.outfits.bem).toBeNull();
    expect(n.pins).toBeNull();
    expect(n.extras).toBeNull();
    expect(n.burned.total).toBe("0");
  });

  it("serves the numbers to any origin, cached for a minute", async () => {
    const { client } = fakeChain(1_300);
    let reads = 0;
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    const app = withNumbers(new Hono(), { pub: client, counts: () => (reads++, counts()), petsIndexedTo: () => 1, sales, contracts: { registry: REG, marketOkb: OKB }, explorer: "https://x" });
    const a = await app.request("/api/numbers");
    expect(a.status).toBe(200);
    expect(a.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await a.json()) as { ok: boolean }).ok).toBe(true);
    await app.request("/api/numbers");
    expect(reads).toBe(1);
  });
});

describe("the numbers are refreshed once at a time, whoever asks (A52)", () => {
  it("requests arriving during a refresh share it", async () => {
    const { client } = fakeChain(1_300);
    let reads = 0;
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    const app = withNumbers(new Hono(), { pub: client, counts: () => (reads++, counts()), petsIndexedTo: () => 1, sales, contracts: { registry: REG, marketOkb: OKB }, explorer: "https://x" });
    const all = await Promise.all(Array.from({ length: 5 }, () => app.request("/api/numbers")));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(reads).toBe(1);
  });
});
