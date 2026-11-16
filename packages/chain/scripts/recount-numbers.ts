/**
 * An independent recount of the live-numbers page (plan 4.10). It reads the same contracts by a different path
 * from the API (its own log walk, its own decoding, its own sums) and compares every number with /api/numbers.
 * Exits non-zero on any difference. Run it against the live site:
 *
 *   tsx scripts/recount-numbers.ts --deployment deployments/xlayer.json --api https://lingxi.knole.me [--rpc <url>] [--registry-from <block>]
 *
 * The pet count does not trust the start block: every pet ever made emits one Hatched, so the recount must also
 * equal the registry's own nextPetId less one.
 */

import { readFileSync } from "node:fs";
import { type Address, createPublicClient, decodeEventLog, http, keccak256, parseAbi, toHex } from "viem";
import type { Deployment } from "../src/registry";
import { XLAYER_ENDPOINTS, createPacedLogs } from "./lib/paced-logs";
import { xLayer } from "../src/tapeout";

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
]);
const topic = (sig: string) => keccak256(toHex(sig));
const T = {
  hatched: topic("Hatched(uint256,address,uint8,address,uint64,uint256)"),
  bred: topic("Bred(uint256,uint128,uint128)"),
  checkpoint: topic("Checkpoint(uint256,uint32,uint256,bytes32)"),
  minted: topic("Minted(uint256,address,uint32,uint256)"),
  sold: topic("Sold(uint256,address,uint32,uint256)"),
};
const views = parseAbi(["function totalBurned() view returns (uint256)", "function total() view returns (uint256)", "function nextPetId() view returns (uint256)"]);
/** Every log of `address` from `from` to `to`, raw (no ABI filter in the query). */
const logsOf = (address: Address, from: number, to: number) => paced.range(address, from, to);

async function main() {
  const live = (await (await fetch(`${api}/api/numbers`, { cache: "no-store" })).json()) as {
    pets: { hatched: number; children: number; daysSaved: number; indexedTo: number; nextPetId: number };
    outfits: { okb: { copies: number; paid: string; indexedTo: number } | null; bem: { copies: number; paid: string; indexedTo: number } | null };
    burned: { market: string; breeding: string; total: string };
    pins: number | null;
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
  check("every pet ever made was counted (hatched + born = nextPetId - 1)", hatched + children, nextPetId - 1);
  check("nextPetId", Number(await pub.readContract({ address: d.registry, abi: views, functionName: "nextPetId" })), live.pets.nextPetId);

  // sales, each market up to the block the page has read it to
  const markets: Array<[string, Address | undefined, number | undefined, { copies: number; paid: string; indexedTo: number } | null]> = [
    ["OKB market", d.outfitMarket, d.outfitMarketBlock, live.outfits.okb],
    ["BEM market", d.outfitMarketV2, d.outfitMarketV2Block, live.outfits.bem],
  ];
  for (const [name, address, from, page] of markets) {
    if (!address || !from || !page) continue;
    let copies = 0;
    let paid = 0n;
    for (const l of await logsOf(address, from, page.indexedTo)) {
      if (l.topics[0] !== T.minted && l.topics[0] !== T.sold) continue;
      const ev = decodeEventLog({ abi: events, data: l.data, topics: l.topics });
      const a = ev.args as { quantity: number; paid: bigint };
      copies += Number(a.quantity);
      paid += a.paid;
    }
    check(`${name} copies`, copies, page.copies);
    check(`${name} paid`, paid.toString(), page.paid);
  }

  // contract totals, read fresh; a sale between the page's read and this one shows as a difference, so read twice
  const read = async (a: Address | undefined, fn: "totalBurned" | "total") => (a ? ((await pub.readContract({ address: a, abi: views, functionName: fn })) as bigint) : 0n);
  const market = await read(d.outfitMarketV2, "totalBurned");
  const breeding = d.breederBem ? await read(d.breeder, "totalBurned") : 0n;
  check("BEM burned by the market", market.toString(), live.burned.market);
  check("BEM burned by breeding", breeding.toString(), live.burned.breeding);
  check("BEM burned in total", (market + breeding).toString(), live.burned.total);
  if (d.holderGift) check("holder pins claimed", Number(await read(d.holderGift, "total")), live.pins ?? "absent");

  if (diffs.length) {
    console.error(`${diffs.length} difference(s): ${diffs.join(", ")}`);
    process.exit(1);
  }
  console.log("every number on the page equals the recount");
}

main().catch((e) => (console.error(e), process.exit(1)));
