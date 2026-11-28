import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { NUMBERS_WAIT_MS, createNumbersCache, createSalesCounter, readNumbers, withNumbers } from "../src/numbers";

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
      return (sales[address] ?? [])
        .filter((s) => s.block >= Number(fromBlock) && s.block <= Number(toBlock))
        .map((s) => ({ args: { quantity: s.quantity, paid: s.paid }, blockNumber: BigInt(s.block) }));
    },
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: string;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      if (functionName === "nextPetId") return 12n;
      if (functionName === "totalBurned")
        return address === BEM
          ? 4_200_000n
          : address === BREEDER
            ? 10_000_000n
            : address === SHOP
              ? 15_000_000n
              : address === EXTRAS
                ? 25_000_000n
                : 0n;
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
    {
      block: 1_300,
      eventName: "FeeChanged",
      args: { feeBps: 500, treasury: "0x00000000000000000000000000000000000000aa" },
    },
    { block: 1_350, eventName: "Sold", args: { quantity: 1, paid: 1_000_000_000_000_000n } },
  ];
  return {
    getBlockNumber: async () => 1_400n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs
        .filter((l) => l.block >= Number(fromBlock) && l.block <= Number(toBlock))
        .map((l, i) => ({ ...l, blockNumber: BigInt(l.block), logIndex: i })),
  } as unknown as PublicClient;
}

const TEAM = "0x00000000000000000000000000000000000000f6";
const ALICE = "0x0000000000000000000000000000000000000a1c";
const BOB = "0x0000000000000000000000000000000000000b0b";

/** C2: designs, listings and sales on the OKB market, by the team, by a creator buying their own, and by players. */
function whoChain() {
  const logs = [
    { block: 1_001, eventName: "Created", args: { id: 1n, creator: TEAM } },
    { block: 1_002, eventName: "Created", args: { id: 2n, creator: ALICE } },
    // the team buys its own design: the team's
    { block: 1_010, eventName: "Minted", args: { id: 1n, buyer: TEAM, quantity: 1, paid: 1_000_000_000_000_000n } },
    // Alice buys her own design: a self-buy, not a player's purchase
    { block: 1_020, eventName: "Minted", args: { id: 2n, buyer: ALICE, quantity: 2, paid: 2_000_000_000_000_000n } },
    // Bob buys the team's design twice and Alice's once: one distinct player buyer
    { block: 1_030, eventName: "Minted", args: { id: 1n, buyer: BOB, quantity: 1, paid: 1_000_000_000_000_000n } },
    { block: 1_040, eventName: "Minted", args: { id: 2n, buyer: BOB, quantity: 1, paid: 1_000_000_000_000_000n } },
    // Bob lists his copy; Bob buying back his own listing is a self-buy; Alice buying it is a player's purchase
    { block: 1_050, eventName: "Listed", args: { listingId: 7n, seller: BOB, id: 1n } },
    {
      block: 1_060,
      eventName: "Sold",
      args: { listingId: 7n, buyer: ALICE, quantity: 1, paid: 4_000_000_000_000_000n },
    },
  ];
  return {
    getBlockNumber: async () => 1_100n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs
        .filter((l) => l.block >= Number(fromBlock) && l.block <= Number(toBlock))
        .map((l, i) => ({ ...l, blockNumber: BigInt(l.block), logIndex: i })),
  } as unknown as PublicClient;
}

describe("the team's own activity, told apart (C2)", () => {
  it("splits every sale into the team's, a creator's or seller's own, and players', and counts distinct player buyers", async () => {
    const s = createSalesCounter({
      rpc: "",
      markets: [{ address: OKB, fromBlock: 1_000, earns: { project: TEAM, feeBps: 300, treasury: TEAM } }],
      team: [TEAM],
      client: whoChain(),
      paceMs: 0,
    });
    await s.catchUp();
    expect(s.totals(OKB)).toEqual({
      copies: 6,
      paid: "9000000000000000",
      sales: 5,
      byTeam: { copies: 1, paid: "1000000000000000" },
      selfBuys: { copies: 2, paid: "2000000000000000" },
      byPlayers: { copies: 3, paid: "6000000000000000", buyers: 2 },
    });
    // 3% of every sale to the project; of it, 3% of the team's own purchase is the team paying itself
    expect(s.earned(OKB)).toMatchObject({ okb: "270000000000000", fromTeam: "30000000000000" });
  });
});

describe("live numbers", () => {
  it("counts what the OKB market paid the project: each sale's fee at the rate in force, only while the treasury is the project's (H8)", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "earn-")), "sales.json");
    const s = createSalesCounter({
      rpc: "",
      markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }],
      store,
      client: feeChain(),
      paceMs: 0,
    });
    await s.catchUp();
    // 3% of 0.002 OKB, then 5% of 0.003 OKB; the last sale's fee went to someone else's treasury
    expect(s.totals(OKB)).toMatchObject({ copies: 4, paid: "6000000000000000", sales: 3 });
    expect(s.earned(OKB)).toEqual({
      okb: (60_000_000_000_000n + 150_000_000_000_000n).toString(),
      feeBps: 500,
      treasury: "0x00000000000000000000000000000000000000aa",
      toProject: false,
      fromTeam: "0",
    });
    // a restart resumes with the rate and treasury it had reached
    const again = createSalesCounter({
      rpc: "",
      markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }],
      store,
      client: feeChain(),
      paceMs: 0,
    });
    await again.catchUp();
    expect(again.earned(OKB)).toEqual(s.earned(OKB));
  });

  it("a file counted before earnings were counted is counted again from the market's first block", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "earn-")), "sales.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      store,
      JSON.stringify({ next: { [OKB]: 1_401 }, totals: { [OKB]: { copies: 4, paid: "6000000000000000", sales: 3 } } }),
    );
    const s = createSalesCounter({
      rpc: "",
      markets: [{ address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } }],
      store,
      client: feeChain(),
      paceMs: 0,
    });
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
    expect(s.totals(OKB)).toMatchObject({ copies: 3, paid: "5000000000000000", sales: 2 });
    expect(s.totals(BEM)).toMatchObject({ copies: 5, paid: "130000000", sales: 3 });
    expect(calls.every(([a, b]) => b - a < 100)).toBe(true);
    expect(s.head(BEM)).toBe(2_150);
    // a restart reads its place back and counts nothing twice
    const again = createSalesCounter({ rpc: "", markets, store, client: fakeChain(2_150).client, paceMs: 0 });
    await again.catchUp();
    expect(again.totals(BEM)).toMatchObject({ copies: 5, paid: "130000000", sales: 3 });
  });

  it("reads contract totals from the contracts and links every source", async () => {
    const { client } = fakeChain(2_150);
    const sales = createSalesCounter({
      rpc: "",
      markets: [
        { address: OKB, fromBlock: 1_000 },
        { address: BEM, fromBlock: 2_000 },
      ],
      client,
      paceMs: 0,
    });
    await sales.catchUp();
    const n = await readNumbers(
      {
        pub: client,
        counts,
        petsIndexedTo: () => 2_140,
        sales,
        contracts: {
          registry: REG,
          marketOkb: OKB,
          marketBem: BEM,
          breeder: BREEDER,
          gift: GIFT,
          itemShop: SHOP,
          extras: EXTRAS,
        },
        explorer: "https://x",
      },
      1_800_000_000_000,
    );
    expect(n.head).toBe(2_150);
    expect(n.pets).toEqual({
      hatched: 9,
      children: 2,
      daysSaved: 40,
      savedLast24h: 3,
      hatchers: 5,
      nextPetId: 12,
      indexedTo: 2_140,
    });
    // the item shop's whole price is burned and counts in the total (plan 4.6), and so do the paid extras (plan 4.9)
    expect(n.burned).toEqual({
      market: "4200000",
      breeding: "10000000",
      shop: "15000000",
      adoption: "0",
      extras: "25000000",
      total: "54200000",
    });
    expect(n.extras).toEqual({ room: 2, looks: 1, colours: 2 });
    expect(n.contracts.extras).toEqual({ address: EXTRAS, url: `https://x/address/${EXTRAS}` });
    expect(n.contracts.itemShop).toEqual({ address: SHOP, url: `https://x/address/${SHOP}` });
    expect(n.pins).toBe(7);
    expect(n.outfits.bem?.copies).toBe(5);
    expect(n.contracts.marketBem).toEqual({ address: BEM, url: `https://x/address/${BEM}` });
  });

  it("serves the project's earnings beside the burns, with the rate and the wallet they go to (H8)", async () => {
    const { client } = fakeChain(2_150);
    const sales = createSalesCounter({
      rpc: "",
      markets: [
        { address: OKB, fromBlock: 1_000, earns: { project: PROJECT, feeBps: 300, treasury: PROJECT } },
        { address: BEM, fromBlock: 2_000 },
      ],
      client,
      paceMs: 0,
    });
    await sales.catchUp();
    const n = await readNumbers({
      pub: client,
      counts,
      petsIndexedTo: () => 2_140,
      sales,
      contracts: { registry: REG, marketOkb: OKB, marketBem: BEM },
      explorer: "https://x",
    });
    // 3% of the 0.005 OKB the two sales paid
    expect(n.earned).toEqual({
      okb: "150000000000000",
      feeBps: 300,
      treasury: PROJECT,
      toProject: true,
      fromTeam: "0",
      indexedTo: 2_150,
    });
    const none = await readNumbers({
      pub: client,
      counts,
      petsIndexedTo: () => 2_140,
      sales: createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 }),
      contracts: { registry: REG, marketOkb: OKB },
      explorer: "https://x",
    });
    expect(none.earned).toBeNull();
  });

  it("serves the week's activity, who kept the pets, and the circuits taped out (H10)", async () => {
    const { client } = fakeChain(2_150);
    const PROC = "0x00000000000000000000000000000000000000f9" as const;
    const withNext = {
      ...client,
      readContract: async (r: { address: string; functionName: string }) =>
        r.functionName === "nextId" ? 23n : (client.readContract as (x: unknown) => Promise<unknown>)(r),
    } as unknown as typeof client;
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    const n = await readNumbers(
      {
        pub: withNext,
        counts,
        petsIndexedTo: () => 2_140,
        sales,
        activity: (since) => ({ hatched: since > 0 ? 2 : 9, children: 1, saves: 5, petsSaved: 3, hatchers: 2 }),
        keepers: () => ({ own: 4, sponsored: 6, other: 0 }),
        sponsors: ["0x00000000000000000000000000000000000000ee"],
        circuits: { processor: PROC, counter: { totals: () => ({ minted: 22, since: 7, indexedTo: 2_100 }) } },
        contracts: { registry: REG, marketOkb: OKB },
        explorer: "https://x",
      },
      1_800_000_000_000,
    );
    expect(n.week).toEqual({
      since: 1_800_000_000 - 7 * 86_400,
      hatched: 2,
      children: 1,
      saves: 5,
      petsSaved: 3,
      hatchers: 2,
      circuits: 7,
    });
    expect(n.kept).toEqual({
      own: 4,
      sponsored: 6,
      other: 0,
      sponsors: ["0x00000000000000000000000000000000000000ee"],
    });
    // nextId is the processor's latest circuit id (ids start at 1), so 23 means 23 circuits
    expect(n.circuits).toEqual({
      total: 23,
      minted: 22,
      last7d: 7,
      indexedTo: 2_100,
      fromBlock: null,
      processor: PROC,
    });
    expect(n.contracts.processor).toEqual({ address: PROC, url: `https://x/address/${PROC}` });

    // C2: the team's wallets, its share of the pets, and whether the free keep is on, served beside the figures
    const told = await readNumbers(
      {
        pub: withNext,
        counts,
        petsIndexedTo: () => 2_140,
        sales,
        activity: () => ({ hatched: 2, children: 1, saves: 5, petsSaved: 3, hatchers: 2 }),
        keepers: () => ({ own: 4, sponsored: 6, other: 0 }),
        sponsorOn: () => false,
        team: {
          wallets: [PROJECT],
          hidden: 1,
          byTeam: () => ({
            all: { hatched: 9, children: 2, saves: 40, hatchers: 3 },
            week: { hatched: 2, children: 1, saves: 5, petsSaved: 3, hatchers: 2 },
          }),
        },
        contracts: { registry: REG },
        explorer: "https://x",
      },
      1_800_000_000_000,
    );
    expect(told.team).toEqual({ wallets: [PROJECT], hidden: 1 });
    expect(told.pets.byTeam).toEqual({ hatched: 9, children: 2, saves: 40, hatchers: 3, savedLast24h: 3 });
    expect(told.week?.byTeam).toEqual({ hatched: 2, children: 1, saves: 5, petsSaved: 3, hatchers: 2 });
    expect(told.kept?.sponsorOn).toBe(false);

    // while the walk of mints is still far behind the head, the newest mints are unread: no 7-day count is given
    const behind = await readNumbers(
      {
        pub: withNext,
        counts,
        petsIndexedTo: () => 2_140,
        sales,
        activity: () => ({ hatched: 0, children: 0, saves: 0, petsSaved: 0, hatchers: 0 }),
        circuits: { processor: PROC, counter: { totals: () => ({ minted: 5, since: 0, indexedTo: 1_000 }) } },
        contracts: { registry: REG },
        explorer: "https://x",
      },
      1_800_000_000_000,
    );
    expect(behind.circuits?.last7d).toBeNull();
    expect(behind.week?.circuits).toBeNull();
    expect(behind.circuits?.total).toBe(23);

    // C7: with the processor's own count to ask, the week's figure never waits on the walk
    const told7 = await readNumbers(
      {
        pub: withNext,
        counts,
        petsIndexedTo: () => 2_140,
        sales,
        activity: () => ({ hatched: 0, children: 0, saves: 0, petsSaved: 0, hatchers: 0 }),
        circuits: {
          processor: PROC,
          counter: { totals: () => ({ minted: 5, since: 0, indexedTo: 1_000 }), week: async () => 4 },
        },
        contracts: { registry: REG },
        explorer: "https://x",
      },
      1_800_000_000_000,
    );
    expect(told7.circuits?.last7d).toBe(4);
    expect(told7.week?.circuits).toBe(4);
    // and when that read fails while the walk is behind, nothing is guessed
    const failing = await readNumbers(
      {
        pub: withNext,
        counts,
        petsIndexedTo: () => 2_140,
        sales,
        activity: () => ({ hatched: 0, children: 0, saves: 0, petsSaved: 0, hatchers: 0 }),
        circuits: {
          processor: PROC,
          counter: {
            totals: () => ({ minted: 5, since: 0, indexedTo: 1_000 }),
            week: async () => Promise.reject(new Error("node down")),
          },
        },
        contracts: { registry: REG },
        explorer: "https://x",
      },
      1_800_000_000_000,
    );
    expect(failing.circuits?.last7d).toBeNull();
  });

  it("before the BEM contracts exist, their numbers are absent rather than invented", async () => {
    const { client } = fakeChain(1_300);
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    await sales.catchUp();
    const n = await readNumbers({
      pub: client,
      counts,
      petsIndexedTo: () => 1_290,
      sales,
      contracts: { registry: REG, marketOkb: OKB },
      explorer: "https://x",
    });
    expect(n.outfits.bem).toBeNull();
    expect(n.pins).toBeNull();
    expect(n.extras).toBeNull();
    expect(n.burned.total).toBe("0");
  });

  it("serves the numbers to any origin, cached for a minute", async () => {
    const { client } = fakeChain(1_300);
    let reads = 0;
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    const app = withNumbers(new Hono(), {
      pub: client,
      counts: () => (reads++, counts()),
      petsIndexedTo: () => 1,
      sales,
      contracts: { registry: REG, marketOkb: OKB },
      explorer: "https://x",
    });
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
    const app = withNumbers(new Hono(), {
      pub: client,
      counts: () => (reads++, counts()),
      petsIndexedTo: () => 1,
      sales,
      contracts: { registry: REG, marketOkb: OKB },
      explorer: "https://x",
    });
    const all = await Promise.all(Array.from({ length: 5 }, () => app.request("/api/numbers")));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(reads).toBe(1);
  });
});

describe("the numbers answer at once, kept fresh behind the page (R74)", () => {
  /**
   * The chain's slow read, held open until the test lets it go: a cold visit used to wait for a whole read of the chain
   * (8.4 s on the live site) because the numbers were read only when someone asked and kept for a minute.
   */
  function slowDeps() {
    const { client } = fakeChain(1_300);
    let gate: (() => void) | null = null;
    let reads = 0;
    let failing = false;
    const pub = {
      ...client,
      getBlockNumber: async () => {
        reads++;
        if (failing) throw new Error("node down");
        if (gate === null) return 1_300n;
        await new Promise<void>((go) => (gate = go));
        return 1_300n;
      },
    } as unknown as PublicClient;
    const sales = createSalesCounter({ rpc: "", markets: [{ address: OKB, fromBlock: 1_000 }], client, paceMs: 0 });
    const deps = { pub, counts, petsIndexedTo: () => 1, sales, contracts: { registry: REG }, explorer: "https://x" };
    return {
      deps,
      reads: () => reads,
      /** the next read waits until released */
      hold: () => void (gate = () => undefined),
      release: () => {
        const go = gate;
        gate = null;
        go?.();
      },
      fail: (on: boolean) => void (failing = on),
    };
  }
  const ask = async (app: Hono) => {
    const r = await app.request("/api/numbers");
    return {
      status: r.status,
      maxAge: r.headers.get("cache-control"),
      body: (await r.json()) as { ok: boolean; at: number },
    };
  };

  it("read at start: the first visit is answered from it without a read of its own", async () => {
    const s = slowDeps();
    const numbers = createNumbersCache(s.deps);
    await numbers.refresh();
    const app = withNumbers(new Hono(), s.deps, numbers);
    s.hold();
    const before = s.reads();
    const first = await ask(app);
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(s.reads(), "no read of the chain waited on").toBe(before);
  });

  it("a refresh under way does not hold the page: the last numbers answer while it reads", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    try {
      const s = slowDeps();
      const numbers = createNumbersCache(s.deps);
      await numbers.refresh();
      const app = withNumbers(new Hono(), s.deps, numbers);
      vi.setSystemTime(1_800_000_045_000);
      s.hold();
      const job = numbers.refresh();
      const during = await ask(app);
      expect(during.status).toBe(200);
      expect(during.body.at, "the numbers read 45 s ago").toBe(1_800_000_000_000);
      expect(during.maxAge, "kept by a browser only as long as they are under a minute old").toBe("public, max-age=15");
      s.release();
      await job;
      expect((await ask(app)).body.at).toBe(1_800_000_045_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("numbers over a minute old wait a moment for a read; if the chain is slower, the old ones answer, their age stated", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    try {
      const s = slowDeps();
      const numbers = createNumbersCache(s.deps);
      await numbers.refresh();
      const app = withNumbers(new Hono(), s.deps, numbers);
      vi.setSystemTime(1_800_000_090_000);
      s.hold();
      const answer = ask(app);
      await vi.advanceTimersByTimeAsync(NUMBERS_WAIT_MS + 10);
      const late = await answer;
      expect(late.status).toBe(200);
      expect(late.body.at, "the page shows when these were read").toBe(1_800_000_000_000);
      expect(late.maxAge).toBe("public, max-age=0");
      s.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed read keeps the last numbers and fails the job, so the health page shows it", async () => {
    const s = slowDeps();
    const numbers = createNumbersCache(s.deps);
    await numbers.refresh();
    const kept = numbers.latest()?.at;
    s.fail(true);
    await expect(numbers.refresh()).rejects.toThrow(/node down/);
    expect(numbers.latest()?.at).toBe(kept);
  });

  it("before any read has worked, a visit waits for one, and says so when the chain cannot be read", async () => {
    const s = slowDeps();
    s.fail(true);
    const app = withNumbers(new Hono(), s.deps);
    expect((await ask(app)).status).toBe(503);
    s.fail(false);
    expect((await ask(app)).status).toBe(200);
  });
});
