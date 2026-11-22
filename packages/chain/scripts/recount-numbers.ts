/**
 * An independent recount of the live-numbers page (plan 4.10). It reads the same contracts by a different path
 * from the API (its own log walk, its own decoding, its own sums) and compares every number with /api/numbers.
 * Exits non-zero on any difference. Run it against the live site:
 *
 *   tsx scripts/recount-numbers.ts --deployment deployments/xlayer.json --api https://lingxi.knole.me [--rpc <url>] [--registry-from <block>]
 *
 * The pet count does not trust the start block: every pet ever made emits one Hatched, so the recount must also
 * equal the registry's own nextPetId less one.
 *
 * The community goals (/api/goals) are recounted the same way, by the rules in @lingxi/world goals.ts: owners
 * followed through the registry's Transfer events; each pet-day saved once (Checkpoint), for the owner then; a new
 * pet credited to the wallet it was hatched for at the Checkpoint that saves its SETTLED_DAYS-th different day;
 * each Bred to the child's owner; each Burned on Lingxi's BEM contracts to its payer; only events inside a goal's
 * window by block time; a wallet's saves at most SAVES_PER_WALLET_DAY a day; and no wallet counted beyond
 * walletCap(goal) (goalCounts, shared with the server).
 */

import { readFileSync } from "node:fs";
import { type Address, createPublicClient, decodeEventLog, http, keccak256, parseAbi, toHex } from "viem";
import type { Deployment } from "../src/registry";
import { XLAYER_ENDPOINTS, createPacedLogs } from "./lib/paced-logs";
import { xLayer } from "../src/tapeout";
import { GOALS, type GoalMetric, SETTLED_DAYS, goalCounts } from "@lingxi/world";

const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const d = JSON.parse(readFileSync(arg("deployment")!, "utf8")) as Deployment & { outfitMarketBlock?: number; outfitMarketV2Block?: number };
/** The block the registry was deployed in on X Layer mainnet. */
const registryFrom = Number(arg("registry-from", "75968151"));
const api = arg("api", "https://lingxi.knole.me")!;
// --rpc names one endpoint (a local fork, say); without it the walk is spread over X Layer's public endpoints
const rpcArg = arg("rpc");
const rpc = rpcArg ?? "https://rpc.xlayer.tech";
const paced = createPacedLogs(rpcArg ? [{ url: rpcArg, rate: 20, lanes: 4 }] : XLAYER_ENDPOINTS);
const pub = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc, { timeout: 30_000 }) });

const events = parseAbi([
  "event Hatched(uint256 indexed petId, address indexed to, uint8 line, address processor, uint64 brainId, uint256 state)",
  "event Bred(uint256 indexed petId, uint128 indexed parentA, uint128 indexed parentB)",
  "event Checkpoint(uint256 indexed petId, uint32 indexed day, uint256 state, bytes32 logHash)",
  "event Minted(uint256 indexed id, address indexed buyer, uint32 quantity, uint256 paid)",
  "event Sold(uint256 indexed listingId, address indexed buyer, uint32 quantity, uint256 paid)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Burned(address indexed payer, uint256 amount)",
  "event FeeChanged(uint16 feeBps, address indexed treasury)",
]);
const topic = (sig: string) => keccak256(toHex(sig));
const T = {
  hatched: topic("Hatched(uint256,address,uint8,address,uint64,uint256)"),
  bred: topic("Bred(uint256,uint128,uint128)"),
  checkpoint: topic("Checkpoint(uint256,uint32,uint256,bytes32)"),
  minted: topic("Minted(uint256,address,uint32,uint256)"),
  sold: topic("Sold(uint256,address,uint32,uint256)"),
  transfer: topic("Transfer(address,address,uint256)"),
  burned: topic("Burned(address,uint256)"),
  bought: topic("Bought(address,uint8,uint256,uint256)"),
  feeChanged: topic("FeeChanged(uint16,address)"),
};
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const views = parseAbi(["function totalBurned() view returns (uint256)", "function total() view returns (uint256)", "function nextPetId() view returns (uint256)", "function feeBps() view returns (uint16)", "function treasury() view returns (address)", "function nextId() view returns (uint256)"]);
/**
 * Every log of `address` from `from` to `to`, raw (no ABI filter in the query). A span already read for that address is
 * served from what was read: the goals walk the burners again over the same history, which through public nodes (or
 * a fork) doubled the slowest part of the recount.
 */
const seen = new Map<string, { from: number; to: number; logs: Awaited<ReturnType<typeof paced.range>> }>();
async function logsOf(address: Address, from: number, to: number) {
  const k = address.toLowerCase();
  const have = seen.get(k);
  if (have && have.from <= from && to <= have.to) return have.logs.filter((l) => Number(BigInt(l.blockNumber)) >= from && Number(BigInt(l.blockNumber)) <= to);
  // a later span that starts where the remembered one does is read only past its end
  if (have && have.from === from && to > have.to) {
    const more = await paced.range(address, have.to + 1, to);
    const logs = [...have.logs, ...more];
    seen.set(k, { from, to, logs });
    return logs;
  }
  const logs = await paced.range(address, from, to);
  if (!have || to - from > have.to - have.from) seen.set(k, { from, to, logs });
  return logs;
}

async function main() {
  const live = (await (await fetch(`${api}/api/numbers`, { cache: "no-store" })).json()) as {
    pets: { hatched: number; children: number; daysSaved: number; indexedTo: number; nextPetId: number };
    outfits: { okb: { copies: number; paid: string; indexedTo: number } | null; bem: { copies: number; paid: string; indexedTo: number } | null };
    burned: { market: string; breeding: string; shop?: string; adoption?: string; extras?: string; total: string };
    extras?: { room: number; looks: number; colours: number } | null;
    pins: number | null;
    earned?: { okb: string; feeBps: number; treasury: string; toProject: boolean; indexedTo: number } | null;
    week?: { since: number; hatched: number; children: number; saves: number; petsSaved: number; hatchers: number; circuits: number | null } | null;
    kept?: { own: number; sponsored: number; other: number; sponsors: string[] } | null;
    circuits?: { total: number; minted: number; last7d: number | null; indexedTo: number; fromBlock: number | null; processor: string } | null;
  };
  const diffs: string[] = [];
  const check = (what: string, mine: string | number, theirs: string | number) => {
    const ok = String(mine) === String(theirs);
    console.log(`${ok ? "same" : "DIFFERENT"}  ${what}: recount ${mine}, page ${theirs}`);
    if (!ok) diffs.push(what);
  };

  // pets: up to the block the page says it has read, so both count the same span
  const reg = await logsOf(d.registry, registryFrom, live.pets.indexedTo);
  let hatched = 0;
  let children = 0;
  let saves = 0;
  const bredIds = new Set<string>();
  for (const l of reg) if (l.topics[0] === T.bred) bredIds.add(BigInt(l.topics[1]!).toString());
  for (const l of reg) {
    if (l.topics[0] === T.hatched) {
      const ev = decodeEventLog({ abi: events, data: l.data, topics: l.topics });
      if (bredIds.has(String((ev.args as { petId: bigint }).petId))) children++;
      else hatched++;
    } else if (l.topics[0] === T.checkpoint) saves++;
  }
  check("pets hatched", hatched, live.pets.hatched);
  check("little ones born", children, live.pets.children);
  check("days saved", saves, live.pets.daysSaved);
  const nextPetId = Number(await pub.readContract({ address: d.registry, abi: views, functionName: "nextPetId", blockNumber: BigInt(live.pets.indexedTo) }));
  // every pet made in the walked span was counted: from the registry's first block that is every pet ever made; from a
  // later block (a fork) it is the pets made since, read as nextPetId at the end less nextPetId just before the start
  const before = registryFrom > (d.registryBlock ?? 0) ? Number(await pub.readContract({ address: d.registry, abi: views, functionName: "nextPetId", blockNumber: BigInt(registryFrom - 1) })) : 1;
  check(before === 1 ? "every pet ever made was counted (hatched + born = nextPetId - 1)" : `every pet made since block ${registryFrom} was counted (hatched + born = nextPetId now - nextPetId then)`, hatched + children, nextPetId - before);
  check("nextPetId", Number(await pub.readContract({ address: d.registry, abi: views, functionName: "nextPetId" })), live.pets.nextPetId);

  // the last 7 days and who kept each pet (H10), from the same logs, each block's own time and each hatch's own sender
  const blockTime = new Map<string, number>();
  const timeOfBlock = async (hex: string) => {
    if (!blockTime.has(hex)) blockTime.set(hex, Number((await pub.getBlock({ blockNumber: BigInt(hex) })).timestamp));
    return blockTime.get(hex)!;
  };
  if (live.week || live.kept) {
    const since = live.week?.since ?? 0;
    const relay = new Set((live.kept?.sponsors ?? []).map((x) => x.toLowerCase()));
    const w = { hatched: 0, children: 0, saves: 0, petsSaved: new Set<string>(), hatchers: new Set<string>() };
    const k = { own: 0, sponsored: 0, other: 0 };
    for (const l of reg) {
      if (l.topics[0] === T.hatched) {
        const ev = decodeEventLog({ abi: events, data: l.data, topics: l.topics }).args as { petId: bigint; to: Address };
        const from = String((await pub.getTransaction({ hash: l.transactionHash })).from).toLowerCase();
        if (relay.has(from)) k.sponsored++;
        else if (from === ev.to.toLowerCase()) k.own++;
        else k.other++;
        if ((await timeOfBlock(l.blockNumber)) >= since) {
          if (bredIds.has(String(ev.petId))) w.children++;
          else w.hatched++;
          w.hatchers.add(ev.to.toLowerCase());
        }
      } else if (l.topics[0] === T.checkpoint && (await timeOfBlock(l.blockNumber)) >= since) {
        w.saves++;
        w.petsSaved.add(BigInt(l.topics[1]!).toString());
      }
    }
    if (live.week) {
      check("pets hatched in the last 7 days", w.hatched, live.week.hatched);
      check("little ones born in the last 7 days", w.children, live.week.children);
      check("days saved in the last 7 days", w.saves, live.week.saves);
      check("pets saved in the last 7 days", w.petsSaved.size, live.week.petsSaved);
      check("wallets that hatched in the last 7 days", w.hatchers.size, live.week.hatchers);
    }
    if (live.kept) {
      check("pets kept by their owner's own wallet (the hatch's sender is the owner)", k.own, live.kept.own);
      check("pets kept by Lingxi's relayer (sponsored)", k.sponsored, live.kept.sponsored);
      check("pets kept by another wallet", k.other, live.kept.other);
    }
  }

  // circuits Lingxi has taped out (H10): the processor's mints, walked by this script, and its own count
  if (live.circuits && (live.circuits.fromBlock ?? d.processorBlock)) {
    const from = live.circuits.fromBlock ?? d.processorBlock!;
    let minted = 0;
    let recent = 0;
    for (const l of await logsOf(d.processor, from, live.circuits.indexedTo)) {
      if (l.topics[0] !== T.transfer || l.topics[1] !== ZERO_TOPIC) continue;
      minted++;
      if ((await timeOfBlock(l.blockNumber)) >= (live.week?.since ?? 0)) recent++;
    }
    check("circuits minted on the processor (Transfer events from nobody)", minted, live.circuits.minted);
    if (live.circuits.last7d !== null) check("circuits taped out in the last 7 days", recent, live.circuits.last7d);
    else console.log("not yet  circuits in the last 7 days: the server's walk has not reached the head");
    if (live.week && live.week.circuits !== null) check("circuits in the week's activity", recent, live.week.circuits);
    const next = Number(await pub.readContract({ address: d.processor, abi: views, functionName: "nextId" }));
    // nextId is the id of the processor's latest circuit (ids start at 1), so it is the count itself
    check("circuits taped out (the processor's nextId, its latest circuit id)", next, live.circuits.total);
    // every mint in the walked span was found: nextId at its end less nextId just before its start (none before deployment)
    const atEnd = Number(await pub.readContract({ address: d.processor, abi: views, functionName: "nextId", blockNumber: BigInt(live.circuits.indexedTo) }));
    const before = await pub.readContract({ address: d.processor, abi: views, functionName: "nextId", blockNumber: BigInt(from - 1) }).then(Number, () => 0);
    check(`every circuit minted since block ${from} was walked (mints = nextId then - nextId before)`, minted, atEnd - before);
  }

  // sales, each market up to the block the page has read it to
  const markets: Array<[string, Address | undefined, number | undefined, { copies: number; paid: string; indexedTo: number } | null]> = [
    ["OKB market", d.outfitMarket, d.outfitMarketBlock, live.outfits.okb],
    ["BEM market", d.outfitMarketV2, d.outfitMarketV2Block, live.outfits.bem],
  ];
  for (const [name, address, from, page] of markets) {
    if (!address || !from || !page) continue;
    let copies = 0;
    let paid = 0n;
    // the OKB market pays each sale's fee to its treasury with no fee event: its terms at its first block, read from
    // the chain there, then each FeeChanged in order (H8)
    const earning = address === d.outfitMarket;
    let fee = earning ? BigInt((await pub.readContract({ address, abi: views, functionName: "feeBps", blockNumber: BigInt(from) })) as number) : 0n;
    let treasury = earning ? ((await pub.readContract({ address, abi: views, functionName: "treasury", blockNumber: BigInt(from) })) as Address).toLowerCase() : "";
    const project = (d.deployer ?? "").toLowerCase();
    let earned = 0n;
    const logs = (await logsOf(address, from, page.indexedTo)).slice().sort((x, y) => Number(BigInt(x.blockNumber) - BigInt(y.blockNumber)) || Number(BigInt(x.logIndex) - BigInt(y.logIndex)));
    for (const l of logs) {
      if (earning && l.topics[0] === T.feeChanged) {
        const ev = decodeEventLog({ abi: events, data: l.data, topics: l.topics }).args as { feeBps: number; treasury: Address };
        fee = BigInt(ev.feeBps);
        treasury = ev.treasury.toLowerCase();
        continue;
      }
      if (l.topics[0] !== T.minted && l.topics[0] !== T.sold) continue;
      const ev = decodeEventLog({ abi: events, data: l.data, topics: l.topics });
      const a = ev.args as { quantity: number; paid: bigint };
      copies += Number(a.quantity);
      paid += a.paid;
      if (earning && treasury === project) earned += (a.paid * fee) / 10_000n;
    }
    check(`${name} copies`, copies, page.copies);
    check(`${name} paid`, paid.toString(), page.paid);
    if (earning) {
      check("OKB earned by the project (each sale's fee at the rate in force, while the treasury is the project wallet)", earned.toString(), live.earned?.okb ?? "absent");
      check("the OKB market's fee rate now", Number(fee), live.earned?.feeBps ?? "absent");
      check("the treasury it is paid to now", treasury, (live.earned?.treasury ?? "absent").toLowerCase());
    }
  }

  // contract totals, read fresh; a sale between the page's read and this one shows as a difference, so read twice
  const read = async (a: Address | undefined, fn: "totalBurned" | "total") => (a ? ((await pub.readContract({ address: a, abi: views, functionName: fn })) as bigint) : 0n);
  const market = await read(d.outfitMarketV2, "totalBurned");
  const breeding = d.breederBem ? await read(d.breeder, "totalBurned") : 0n;
  check("BEM burned by the market", market.toString(), live.burned.market);
  check("BEM burned by breeding", breeding.toString(), live.burned.breeding);
  // the item shop: its burns summed from its own Burned events, an independent count of what totalBurned says
  let shop = 0n;
  if (d.itemShop && d.itemShopBlock) {
    for (const l of await logsOf(d.itemShop, d.itemShopBlock, Number(await pub.getBlockNumber()))) {
      if (l.topics[0] !== T.burned) continue;
      shop += (decodeEventLog({ abi: events, data: l.data, topics: l.topics }).args as { amount: bigint }).amount;
    }
    check("BEM burned by the item shop (sum of its Burned events)", shop.toString(), live.burned.shop ?? "absent");
  }
  let adoption = 0n;
  if (d.adoptionCentre && d.adoptionCentreBlock) {
    for (const l of await logsOf(d.adoptionCentre, d.adoptionCentreBlock, Number(await pub.getBlockNumber()))) {
      if (l.topics[0] !== T.burned) continue;
      adoption += (decodeEventLog({ abi: events, data: l.data, topics: l.topics }).args as { amount: bigint }).amount;
    }
    check("BEM burned by the adoption centre (sum of its Burned events)", adoption.toString(), live.burned.adoption ?? "absent");
  }
  // the paid extras: burns summed from Burned events, purchases counted from Bought events by feature
  let extras = 0n;
  if (d.extras && d.extrasBlock) {
    const sold = [0, 0, 0];
    for (const l of await logsOf(d.extras, d.extrasBlock, Number(await pub.getBlockNumber()))) {
      if (l.topics[0] === T.burned) extras += (decodeEventLog({ abi: events, data: l.data, topics: l.topics }).args as { amount: bigint }).amount;
      else if (l.topics[0] === T.bought) sold[Number(BigInt(l.topics[2]!))]! += 1;
    }
    check("BEM burned by the extras (sum of its Burned events)", extras.toString(), live.burned.extras ?? "absent");
    check("room packs bought (Bought events)", sold[0]!, live.extras?.room ?? "absent");
    check("look packs bought (Bought events)", sold[1]!, live.extras?.looks ?? "absent");
    check("name colours bought (Bought events)", sold[2]!, live.extras?.colours ?? "absent");
  }
  check("BEM burned in total", (market + breeding + shop + adoption + extras).toString(), live.burned.total);
  if (d.holderGift) check("holder pins claimed", Number(await read(d.holderGift, "total")), live.pins ?? "absent");

  // community goals, each up to the block the goals page has read to
  const goalsPage = (await (await fetch(`${api}/api/goals`, { cache: "no-store" })).json()) as { indexedTo: number; goals: Array<{ id: string; total: number; contributors: number; top: Array<{ wallet: string; n: number }> }> };
  const to = goalsPage.indexedTo;
  const raw = [...(await logsOf(d.registry, registryFrom, to))];
  const burners = [d.breederBem ? [d.breeder, (d as { breederBlock?: number }).breederBlock] : null, [d.outfitMarketV2, d.outfitMarketV2Block], [d.itemShop, d.itemShopBlock], [d.adoptionCentre, d.adoptionCentreBlock], [d.extras, d.extrasBlock]].filter((x): x is [Address, number] => !!x && !!x[0] && !!x[1]);
  // the server's goal ledger reads every source from the same start block as the registry, so the recount does too
  for (const [a, from] of burners) raw.push(...(await logsOf(a, Math.max(from, registryFrom), to)));
  raw.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  const owners = new Map<string, string>();
  // per pet: the wallet it was hatched for, the different days saved, and whether it has counted as a new pet
  const kept = new Map<string, { to: string; days: Set<number>; counted: boolean }>();
  const times = new Map<number, number>();
  const credits: Array<{ m: GoalMetric; w: string; n: number; t: number }> = [];
  const timeOf = async (b: number) => {
    if (!times.has(b)) times.set(b, Number((await pub.getBlock({ blockNumber: BigInt(b) })).timestamp));
    return times.get(b)!;
  };
  for (const l of raw) {
    const b = Number(BigInt(l.blockNumber));
    const fromRegistry = l.address.toLowerCase() === d.registry.toLowerCase();
    const t0 = l.topics[0];
    if (fromRegistry && t0 === T.transfer) owners.set(BigInt(l.topics[3]!).toString(), `0x${l.topics[2]!.slice(26)}`.toLowerCase());
    else if (fromRegistry && t0 === T.hatched) kept.set(BigInt(l.topics[1]!).toString(), { to: `0x${l.topics[2]!.slice(26)}`.toLowerCase(), days: new Set(), counted: false });
    else if (fromRegistry && t0 === T.bred) credits.push({ m: "children", w: owners.get(BigInt(l.topics[1]!).toString())!, n: 1, t: await timeOf(b) });
    else if (fromRegistry && t0 === T.checkpoint) {
      const pet = BigInt(l.topics[1]!).toString();
      const day = Number(BigInt(l.topics[2]!));
      const k = kept.get(pet);
      if (!k || k.days.has(day)) continue;
      k.days.add(day);
      credits.push({ m: "saves", w: owners.get(pet)!, n: 1, t: await timeOf(b) });
      if (!k.counted && k.days.size >= SETTLED_DAYS) {
        k.counted = true;
        credits.push({ m: "hatched", w: k.to, n: 1, t: await timeOf(b) });
      }
    }
    else if (!fromRegistry && t0 === T.burned) {
      const ev = decodeEventLog({ abi: events, data: l.data, topics: l.topics });
      const a = ev.args as { payer: Address; amount: bigint };
      credits.push({ m: "burned", w: a.payer.toLowerCase(), n: Number(a.amount), t: await timeOf(b) });
    }
  }
  for (const g of GOALS) {
    const by = goalCounts(g, credits);
    const page = goalsPage.goals.find((x) => x.id === g.id);
    check(`goal ${g.id} total`, [...by.values()].reduce((s, n) => s + n, 0), page?.total ?? "absent");
    check(`goal ${g.id} contributors`, by.size, page?.contributors ?? "absent");
    for (const t of page?.top ?? []) check(`goal ${g.id} ${t.wallet}`, by.get(t.wallet) ?? 0, t.n);
  }

  if (diffs.length) {
    console.error(`${diffs.length} difference(s): ${diffs.join(", ")}`);
    process.exit(1);
  }
  console.log("every number on the page equals the recount");
}

main().catch((e) => (console.error(e), process.exit(1)));
