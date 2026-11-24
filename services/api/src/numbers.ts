/**
 * Live numbers (plan 4.10): what Lingxi has done on X Layer, read from the chain. Pet counts come from the pet
 * indexer (PetRegistry's events); outfit sales from the two markets' Minted and Sold events, read here in the
 * same 100-block windows; burned BEM, pins claimed and pets hatched from the contracts' own views. Each number
 * carries the contract it comes from and what it counts, so anyone can check it.
 */

import type { Hono } from "hono";
import { type Address, type PublicClient, createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { WINDOW } from "./indexer";
import { hasStore, readStore, saveJson } from "./durable";
import type { RefScanner } from "./refScan";

const SALES = [
  parseAbiItem("event Minted(uint256 indexed id, address indexed buyer, uint32 quantity, uint256 paid)"),
  parseAbiItem("event Sold(uint256 indexed listingId, address indexed buyer, uint32 quantity, uint256 paid)"),
] as const;
/**
 * Who made each design and who listed each copy (C2), so a creator buying their own design, or a seller their own
 * listing, is told from a player's purchase. Both markets index the creator and the seller; `Listed` differs in its other
 * fields between the first market and the second, so both forms are read.
 */
const WHO = [
  parseAbiItem(
    "event Created(uint256 indexed id, address indexed creator, uint8 slot, uint96 price, uint32 maxSupply, uint16 royaltyBps, string name)",
  ),
  parseAbiItem(
    "event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed id, uint32 quantity, uint96 priceEach)",
  ),
  parseAbiItem(
    "event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed id, uint32 quantity, uint96 priceEach, uint64 expiresAt, address buyer)",
  ),
] as const;
/** Bumped when the stored totals gain a field only a fresh walk can fill (C2: who bought). */
const SALES_STORE_VERSION = 2;
/** The OKB market's fee: a sale emits no fee event, so the fee is each payment at the rate in force (OutfitMarket.sol). */
const FEE_CHANGED = parseAbiItem("event FeeChanged(uint16 feeBps, address indexed treasury)");
const BPS = 10_000n;
const views = parseAbi([
  "function totalBurned() view returns (uint256)",
  "function total() view returns (uint256)",
  "function nextPetId() view returns (uint256)",
  "function sold(uint8) view returns (uint256)",
  "function nextId() view returns (uint256)",
]);
/** The span of the page's activity line (H10). */
const WEEK_SEC = 7 * 86_400;
/**
 * The walk of circuit mints reads forward from the processor's deploy block, so the newest mints are read last: until it
 * is within this many blocks (about ten minutes) of the head, a count of the last 7 days would be too low, and is null.
 */
const CAUGHT_UP_BLOCKS = 600;

export interface MarketTotals {
  /** copies sold by creators and by resellers */
  copies: number;
  /** what buyers paid, in the market's own currency's base units */
  paid: string;
  sales: number;
  /** bought by the team's own wallets (C2) */
  byTeam: { copies: number; paid: string };
  /** a creator buying their own design, or a seller their own listing, outside the team (C2) */
  selfBuys: { copies: number; paid: string };
  /** bought by everyone else, and how many distinct wallets bought (plan 37's H10 addendum) */
  byPlayers: { copies: number; paid: string; buyers: number };
}

type Split = { copies: number; paid: string };
const emptySplit = (): Split => ({ copies: 0, paid: "0" });

/** What a market that pays a fee to a treasury has paid the project (H8). */
export interface Earned {
  /** OKB paid to the project's treasury, in wei: each sale's fee at the rate in force when it was paid */
  okb: string;
  /** the rate now, and the treasury it is paid to now */
  feeBps: number;
  treasury: Address;
  /** whether that treasury is the project's wallet */
  toProject: boolean;
  /** of `okb`, what came from the team's own purchases: the team paying itself (C2) */
  fromTeam: string;
}

interface Stored {
  v?: number;
  next: Record<string, number>;
  totals: Record<
    string,
    { copies: number; paid: string; sales: number; byTeam: Split; selfBuys: Split; byPlayers: Split; buyers: string[] }
  >;
  /** per market: each design's creator and each listing's seller, lower-cased */
  creators: Record<string, Record<string, string>>;
  sellers: Record<string, Record<string, string>>;
  /** per earning market: what it has paid the project, and the rate and treasury its walk has reached */
  earned?: Record<string, { okb: string; feeBps: number; treasury: string; fromTeam: string }>;
}

/** A market whose fee goes to a treasury (the first, OKB market): its rate and treasury at its first block. */
export interface EarningTerms {
  project: Address;
  feeBps: number;
  treasury: Address;
}

/** Counts every sale on the given markets, walking forward from each market's deploy block. */
export function createSalesCounter(opts: {
  rpc: string;
  markets: Array<{ address: Address; fromBlock: number; earns?: EarningTerms }>;
  team?: readonly string[];
  store?: string;
  client?: PublicClient;
  paceMs?: number;
}) {
  const pub =
    opts.client ??
    (createPublicClient({ transport: http(opts.rpc, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  const team = new Set((opts.team ?? []).map((a) => a.toLowerCase()));
  let data: Stored = { v: SALES_STORE_VERSION, next: {}, totals: {}, creators: {}, sellers: {} };
  if (opts.store && hasStore(opts.store)) {
    try {
      const held = readStore(opts.store) as Stored;
      // a store from before C2 knows no buyers: the markets are read again from their first blocks
      if (held.v === SALES_STORE_VERSION) data = held;
    } catch {
      // a damaged file starts again from the deploy blocks
    }
  }
  data.earned ??= {};
  for (const m of opts.markets) {
    const k = m.address.toLowerCase();
    // a market whose earnings were never counted is walked again from its first block, so every fee is in them
    const fresh = () => ({
      copies: 0,
      paid: "0",
      sales: 0,
      byTeam: emptySplit(),
      selfBuys: emptySplit(),
      byPlayers: emptySplit(),
      buyers: [] as string[],
    });
    if (m.earns && !data.earned[k]) {
      data.next[k] = m.fromBlock;
      data.totals[k] = fresh();
      data.creators[k] = {};
      data.sellers[k] = {};
      data.earned[k] = { okb: "0", feeBps: m.earns.feeBps, treasury: m.earns.treasury, fromTeam: "0" };
    }
    data.next[k] ??= m.fromBlock;
    data.totals[k] ??= fresh();
    data.creators[k] ??= {};
    data.sellers[k] ??= {};
  }
  const terms = new Map(opts.markets.filter((m) => m.earns).map((m) => [m.address.toLowerCase(), m.earns!]));
  const save = () => {
    if (!opts.store) return;
    saveJson(opts.store, undefined, JSON.stringify(data));
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let running = false;

  async function catchUp(maxWindows = 400): Promise<void> {
    if (running) return;
    running = true;
    try {
      // the head as it is now: viem keeps a block number it has read for a few seconds, which would stop a catch-up short
      const head = Number(await pub.getBlockNumber({ cacheTime: 0 }));
      for (const m of opts.markets) {
        const k = m.address.toLowerCase();
        for (let i = 0; i < maxWindows && data.next[k]! <= head; i++) {
          const from = data.next[k]!;
          const to = Math.min(head, from + WINDOW - 1);
          let logs;
          for (let attempt = 0; ; attempt++) {
            try {
              logs = await pub.getLogs({
                address: m.address,
                events: terms.has(k) ? [...SALES, ...WHO, FEE_CHANGED] : [...SALES, ...WHO],
                fromBlock: BigInt(from),
                toBlock: BigInt(to),
              });
              break;
            } catch (e) {
              if (attempt >= 6) throw e;
              await sleep(2000 * (attempt + 1));
            }
          }
          const t = data.totals[k]!;
          const e = data.earned![k];
          const project = terms.get(k)?.project.toLowerCase();
          // in chain order, so a sale is charged the rate in force when it was paid
          const ordered = [...logs].sort(
            (x, y) => Number(x.blockNumber! - y.blockNumber!) || (x.logIndex ?? 0) - (y.logIndex ?? 0),
          );
          for (const l of ordered) {
            const name = (l as { eventName?: string }).eventName;
            if (name === "FeeChanged") {
              const f = l.args as { feeBps: number; treasury: Address };
              if (e) Object.assign(e, { feeBps: Number(f.feeBps), treasury: f.treasury });
              continue;
            }
            if (name === "Created") {
              const c = l.args as { id: bigint; creator: Address };
              data.creators[k]![String(c.id)] = String(c.creator).toLowerCase();
              continue;
            }
            if (name === "Listed") {
              const c = l.args as { listingId: bigint; seller: Address };
              data.sellers[k]![String(c.listingId)] = String(c.seller).toLowerCase();
              continue;
            }
            const a = l.args as { quantity: number; paid: bigint; buyer?: Address; id?: bigint; listingId?: bigint };
            t.copies += Number(a.quantity);
            t.paid = (BigInt(t.paid) + a.paid).toString();
            t.sales += 1;
            // who bought (C2): the team's own wallets, a creator or seller buying their own, or a player
            const buyer = String(a.buyer ?? "").toLowerCase();
            const maker = name === "Minted" ? data.creators[k]![String(a.id)] : data.sellers[k]![String(a.listingId)];
            const split = team.has(buyer) ? t.byTeam : buyer && buyer === maker ? t.selfBuys : t.byPlayers;
            split.copies += Number(a.quantity);
            split.paid = (BigInt(split.paid) + a.paid).toString();
            if (split === t.byPlayers && buyer && !t.buyers.includes(buyer)) t.buyers.push(buyer);
            // the contract rounds each fee down: (total * feeBps) / 10_000
            if (e && e.treasury.toLowerCase() === project) {
              const fee = (a.paid * BigInt(e.feeBps)) / BPS;
              e.okb = (BigInt(e.okb) + fee).toString();
              if (team.has(buyer)) e.fromTeam = (BigInt(e.fromTeam) + fee).toString();
            }
          }
          data.next[k] = to + 1;
          await sleep(opts.paceMs ?? 300);
          if (logs.length || i % 50 === 49) save();
        }
      }
      save();
    } finally {
      running = false;
    }
  }

  return {
    catchUp,
    totals: (market: Address): MarketTotals => {
      const t = data.totals[market.toLowerCase()]!;
      return {
        copies: t.copies,
        paid: t.paid,
        sales: t.sales,
        byTeam: { ...t.byTeam },
        selfBuys: { ...t.selfBuys },
        byPlayers: { ...t.byPlayers, buyers: t.buyers.length },
      };
    },
    /** what an earning market has paid the project, or null for a market whose fee is burned */
    earned: (market: Address): Earned | null => {
      const k = market.toLowerCase();
      const e = data.earned?.[k];
      const t = terms.get(k);
      return e && t
        ? {
            okb: e.okb,
            feeBps: e.feeBps,
            treasury: e.treasury as Address,
            toProject: e.treasury.toLowerCase() === t.project.toLowerCase(),
            fromTeam: e.fromTeam,
          }
        : null;
    },
    head: (market: Address) => (data.next[market.toLowerCase()] ?? 0) - 1,
  };
}
export type SalesCounter = ReturnType<typeof createSalesCounter>;

export interface NumbersDeps {
  pub: PublicClient;
  counts: (sinceSec: number) => {
    hatched: number;
    children: number;
    saves: number;
    savedSince: number;
    hatchers: number;
  };
  petsIndexedTo: () => number;
  sales: SalesCounter;
  /** circuits on other processors that REF a Lingxi circuit (H6), counted from chain */
  refs?: RefScanner;
  /** what happened on chain since a time, from PetRegistry's events (H10) */
  activity?: (sinceSec: number) => {
    hatched: number;
    children: number;
    saves: number;
    petsSaved: number;
    hatchers: number;
  };
  /** who kept each pet, by the hatch's sender (H10) */
  keepers?: () => { own: number; sponsored: number; other: number };
  /** Lingxi's relayer, whose hatches are sponsored keeps */
  sponsors?: string[];
  /** whether the free keep is switched on for players now (C2: the page says when it is off) */
  sponsorOn?: () => boolean;
  /**
   * The team's own wallets (C2): those named publicly, how many more are kept in the server's config, and the share of
   * the pet figures that belongs to all of them. The sales counter is given the same full list.
   */
  team?: {
    wallets: string[];
    hidden: number;
    byTeam: (sinceSec: number) => {
      all: { hatched: number; children: number; saves: number; hatchers: number };
      week: { hatched: number; children: number; saves: number; petsSaved: number; hatchers: number };
    };
  };
  /** Lingxi's processor and the walk of its mints (H10) */
  circuits?: {
    processor: Address;
    fromBlock?: number;
    counter: {
      totals: (sinceSec: number) => { minted: number; since: number; indexedTo: number };
      week?: (sinceSec: number) => Promise<number>;
    };
  };
  contracts: {
    registry: Address;
    marketOkb?: Address;
    marketBem?: Address;
    breeder?: Address;
    gift?: Address;
    itemShop?: Address;
    adoption?: Address;
    extras?: Address;
  };
  explorer: string;
}

export interface Numbers {
  ok: true;
  at: number;
  /** the chain's latest block when read: a count whose indexedTo is far behind it is still catching up */
  head: number;
  pets: {
    hatched: number;
    children: number;
    daysSaved: number;
    savedLast24h: number;
    hatchers: number;
    nextPetId: number;
    indexedTo: number;
    byTeam?: { hatched: number; children: number; saves: number; hatchers: number; savedLast24h: number };
  };
  /** the team's own wallets, named and kept private (C2); every figure says how much of it is theirs */
  team: { wallets: string[]; hidden: number } | null;
  outfits: { okb: (MarketTotals & { indexedTo: number }) | null; bem: (MarketTotals & { indexedTo: number }) | null };
  burned: { market: string; breeding: string; shop: string; adoption: string; extras: string; total: string };
  /** the last 7 days (H10): pets hatched and born, days saved, pets saved, wallets that hatched, circuits taped */
  week: {
    since: number;
    hatched: number;
    children: number;
    saves: number;
    petsSaved: number;
    hatchers: number;
    circuits: number | null;
    byTeam?: { hatched: number; children: number; saves: number; petsSaved: number; hatchers: number };
  } | null;
  /** who kept the pets on X Layer (H10): their owner's own wallet, Lingxi's relayer (sponsored), or another wallet */
  kept: { own: number; sponsored: number; other: number; sponsors: string[]; sponsorOn?: boolean } | null;
  /** circuits Lingxi has taped out (H10): the processor's own count, the walk's count of mints, and the last 7 days */
  /** `fromBlock` is where the walk of mints starts: the processor's deploy block, so `minted` equals `total` once read */
  circuits: {
    total: number;
    minted: number;
    last7d: number | null;
    indexedTo: number;
    fromBlock: number | null;
    processor: Address;
  } | null;
  /** what the first (OKB) market's 3% has paid the project (H8); null where no market pays a treasury */
  earned: (Earned & { indexedTo: number }) | null;
  /** paid extras bought (plan 4.9): room packs, look packs and name colours; null before the contract exists */
  extras: { room: number; looks: number; colours: number } | null;
  pins: number | null;
  /** circuits on other TapeOut processors whose netlists REF a Lingxi circuit (H6); complete once every processor is read */
  usedByOthers: {
    circuits: number;
    processors: number;
    scannedProcessors: number;
    cpuCount: number;
    complete: boolean;
  } | null;
  contracts: Record<string, { address: Address; url: string }>;
}

export async function readNumbers(d: NumbersDeps, nowMs = Date.now()): Promise<Numbers> {
  const read = async (address: Address | undefined, fn: "totalBurned" | "total" | "nextPetId"): Promise<bigint> =>
    address ? ((await d.pub.readContract({ address, abi: views, functionName: fn })) as bigint) : 0n;
  const sold = (f: number) =>
    d.pub.readContract({
      address: d.contracts.extras!,
      abi: views,
      functionName: "sold",
      args: [f],
    }) as Promise<bigint>;
  const [head, nextPetId, marketBurned, breedingBurned, shopBurned, adoptionBurned, extrasBurned, pins, extrasSold] =
    await Promise.all([
      d.pub.getBlockNumber({ cacheTime: 0 }),
      read(d.contracts.registry, "nextPetId"),
      read(d.contracts.marketBem, "totalBurned"),
      read(d.contracts.breeder, "totalBurned"),
      read(d.contracts.itemShop, "totalBurned"),
      read(d.contracts.adoption, "totalBurned"),
      read(d.contracts.extras, "totalBurned"),
      d.contracts.gift ? read(d.contracts.gift, "total") : Promise.resolve(null),
      d.contracts.extras ? Promise.all([sold(0), sold(1), sold(2)]) : Promise.resolve(null),
    ]);
  const c = d.counts(Math.floor(nowMs / 1000) - 86_400);
  const since = Math.floor(nowMs / 1000) - WEEK_SEC;
  const nextId = d.circuits
    ? Number(
        (await d.pub.readContract({ address: d.circuits.processor, abi: views, functionName: "nextId" })) as bigint,
      )
    : 0;
  const walked = d.circuits ? d.circuits.counter.totals(since) : null;
  const split = d.team ? d.team.byTeam(since) : null;
  // the week's circuits from the processor's own count (C7); if that read fails, the walk's count once it is caught up
  const walkWeek = walked && Number(head) - walked.indexedTo <= CAUGHT_UP_BLOCKS ? walked.since : null;
  const chainWeek = d.circuits?.counter.week ? await d.circuits.counter.week(since).catch(() => null) : null;
  const circuitsWeek = chainWeek ?? walkWeek;
  const split24 = d.team ? d.team.byTeam(Math.floor(nowMs / 1000) - 86_400) : null;
  const market = (a?: Address) => (a ? { ...d.sales.totals(a), indexedTo: d.sales.head(a) } : null);
  const contracts: Numbers["contracts"] = {};
  for (const [k, a] of Object.entries(d.contracts))
    if (a) contracts[k] = { address: a, url: `${d.explorer}/address/${a}` };
  if (d.circuits)
    contracts.processor = { address: d.circuits.processor, url: `${d.explorer}/address/${d.circuits.processor}` };
  return {
    ok: true,
    at: nowMs,
    head: Number(head),
    pets: {
      hatched: c.hatched,
      children: c.children,
      daysSaved: c.saves,
      savedLast24h: c.savedSince,
      hatchers: c.hatchers,
      nextPetId: Number(nextPetId),
      indexedTo: d.petsIndexedTo(),
      ...(split && split24 ? { byTeam: { ...split.all, savedLast24h: split24.week.petsSaved } } : {}),
    },
    team: d.team ? { wallets: d.team.wallets, hidden: d.team.hidden } : null,
    outfits: { okb: market(d.contracts.marketOkb), bem: market(d.contracts.marketBem) },
    burned: {
      market: marketBurned.toString(),
      breeding: breedingBurned.toString(),
      shop: shopBurned.toString(),
      adoption: adoptionBurned.toString(),
      extras: extrasBurned.toString(),
      total: (marketBurned + breedingBurned + shopBurned + adoptionBurned + extrasBurned).toString(),
    },
    week: d.activity
      ? {
          since,
          ...d.activity(since),
          ...(split ? { byTeam: split.week } : {}),
          circuits: walked ? circuitsWeek : null,
        }
      : null,
    kept: d.keepers
      ? { ...d.keepers(), sponsors: d.sponsors ?? [], ...(d.sponsorOn ? { sponsorOn: d.sponsorOn() } : {}) }
      : null,
    // the processor's nextId is the id of its latest circuit (ids start at 1: 23 means circuits 1 to 23, read back
    // with ownerOf on mainnet), so it is the count itself
    circuits:
      d.circuits && walked
        ? {
            total: nextId,
            minted: walked.minted,
            last7d: circuitsWeek,
            indexedTo: walked.indexedTo,
            fromBlock: d.circuits.fromBlock ?? null,
            processor: d.circuits.processor,
          }
        : null,
    earned: ((e) => (e && d.contracts.marketOkb ? { ...e, indexedTo: d.sales.head(d.contracts.marketOkb) } : null))(
      d.contracts.marketOkb ? d.sales.earned(d.contracts.marketOkb) : null,
    ),
    extras: extrasSold
      ? { room: Number(extrasSold[0]), looks: Number(extrasSold[1]), colours: Number(extrasSold[2]) }
      : null,
    pins: pins === null ? null : Number(pins),
    usedByOthers: d.refs ? d.refs.totals() : null,
    contracts,
  };
}

/** GET /api/numbers: the live numbers, cached for a minute; readable from any origin (the DeWEB copy reads it too). */
export function withNumbers(app: Hono, d: NumbersDeps): Hono {
  let cache: { at: number; body: Numbers } | null = null;
  // one refresh at a time, whoever asks: requests arriving during it share it (A52)
  let refreshing: Promise<void> | null = null;
  app.get("/api/numbers", async (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "public, max-age=60");
    if (!cache || Date.now() - cache.at > 60_000) {
      refreshing ??= readNumbers(d)
        .then(
          (body) => void (cache = { at: Date.now(), body }),
          () => undefined,
        )
        .finally(() => (refreshing = null));
      await refreshing;
      if (!cache) return c.json({ ok: false, reason: "chain" }, 503);
    }
    return c.json(cache.body);
  });
  return app;
}
