/**
 * The holder snapshot for the holder gift (plan 4.12): every wallet's BEM and FAB balance on X Layer at one
 * fixed block, rebuilt from the tokens' own Transfer events, checked against `balanceOf` at that block, and
 * committed to as an OpenZeppelin standard Merkle tree. Anyone can run this again and get the same root.
 *
 *   tsx scripts/holder-snapshot.ts --block <n> [--bem-min 0.1] [--fab-min 10] [--out <json>] [--cache <dir>]
 *
 * The file written holds only the wallets at or above either minimum, as [wallet, BEM, FAB] in base units; the
 * game rebuilds the tree from it and refuses it unless the root equals the one the gift contract holds.
 *
 * X Layer's public endpoints return logs for at most 100 blocks per query, so the history is read in 100-block
 * windows across several endpoints, each window cached on disk so an interrupted run resumes where it stopped.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Address, type Log, createPublicClient, erc20Abi, http, parseAbiItem } from "viem";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { xLayer } from "../src/tapeout";

const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};

export const TOKENS = {
  bem: { address: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Address, from: 72_256_696n },
  fab: { address: "0x72F349B1Eee7833B26f8C81a8410775A4e231ed2" as Address, from: 73_100_840n },
} as const;
const RPCS = ["https://xlayer.drpc.org", "https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
/** Lanes per endpoint, measured: dRPC served 12 parallel log queries with no errors; the official two rate-limit above one or two. */
const LANES_PER_RPC = [14, 1, 1];
const LANE_RPC = LANES_PER_RPC.flatMap((n, i) => Array.from({ length: n }, () => i));
const WINDOW = 100n;
const CHUNK = 10_000n; // windows are grouped into cached chunks of this many blocks
const ZERO = "0x0000000000000000000000000000000000000000";
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const block = BigInt(arg("block") ?? "0");
if (block <= 0n) throw new Error("--block is required");
const cacheDir = resolve(arg("cache", "../../../research/run/holder-snapshot-cache")!);
const out = resolve(arg("out", "../../apps/web/public/holder-snapshot.json")!);
mkdirSync(cacheDir, { recursive: true });

const clients = RPCS.map((url) => createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [url] } } }, transport: http(url, { timeout: 30_000 }) }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Requests per second each endpoint sustains without refusals (measured: dRPC about 7 with the official two
 * busy, the official endpoints one or two each). Each endpoint's requests are spaced evenly; a refusal widens
 * that endpoint's spacing, a run of successes narrows it back.
 */
const RATE = [7, 1.5, 1.5];
const gap = RATE.map((r) => 1000 / r);
const nextAt = RATE.map(() => 0);
async function slot(i: number) {
  const now = Date.now();
  const at = Math.max(now, nextAt[i]!);
  nextAt[i] = at + gap[i]!;
  if (at > now) await sleep(at - now);
}

/** One 100-block window: its lane's endpoint first, then the others, paced per endpoint. */
async function window(token: Address, from: bigint, to: bigint, lane: number): Promise<Log[]> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const i = (LANE_RPC[lane % LANE_RPC.length]! + Math.floor(attempt / 4)) % clients.length;
    await slot(i);
    try {
      const logs = await clients[i]!.getLogs({ address: token, event: transfer, fromBlock: from, toBlock: to });
      gap[i] = Math.max(1000 / RATE[i]!, gap[i]! * 0.98);
      return logs;
    } catch {
      gap[i] = Math.min(5000, gap[i]! * 1.5);
    }
  }
  throw new Error(`window ${from}-${to} kept failing`);
}

type Row = [string, string, string]; // from, to, value

/** A cached chunk of CHUNK blocks: the transfers in it, as [from, to, value] rows. */
async function chunk(name: string, token: Address, start: bigint, end: bigint, lane: number): Promise<Row[]> {
  const file = resolve(cacheDir, `${name}-${start}-${end}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Row[];
  const rows: Row[] = [];
  for (let a = start; a <= end; a += WINDOW) {
    const b = a + WINDOW - 1n < end ? a + WINDOW - 1n : end;
    for (const l of (await window(token, a, b, lane)) as Array<Log & { args: { from: Address; to: Address; value: bigint } }>) {
      rows.push([l.args.from.toLowerCase(), l.args.to.toLowerCase(), l.args.value.toString()]);
    }
  }
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

async function balancesOf(name: "bem" | "fab"): Promise<Map<string, bigint>> {
  const t = TOKENS[name];
  const starts: bigint[] = [];
  for (let s = t.from - (t.from % CHUNK); s <= block; s += CHUNK) starts.push(s);
  const bal = new Map<string, bigint>();
  let done = 0;
  const lanes = LANE_RPC.length;
  const results: Row[][] = new Array(starts.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: lanes }, async (_, lane) => {
      while (next < starts.length) {
        const i = next++;
        const s = starts[i]!;
        const e = s + CHUNK - 1n < block ? s + CHUNK - 1n : block;
        results[i] = await chunk(name, t.address, s < t.from ? t.from : s, e, lane);
        if (++done % 20 === 0) console.log(`${name}: ${done}/${starts.length} chunks`);
      }
    }),
  );
  for (const rows of results) {
    for (const [from, to, v] of rows) {
      const value = BigInt(v);
      // the zero address mints and burns: it never holds a balance (balanceOf(0x0) is 0 on chain)
      if (from !== ZERO) bal.set(from, (bal.get(from) ?? 0n) - value);
      if (to !== ZERO) bal.set(to, (bal.get(to) ?? 0n) + value);
    }
  }
  for (const [a, v] of bal) if (v === 0n) bal.delete(a);
  return bal;
}

async function main() {
  const [bem, fab] = [await balancesOf("bem"), await balancesOf("fab")];
  // every rebuilt balance must equal the token's own balanceOf at the snapshot block
  const c = clients[0]!;
  for (const [name, m] of [["bem", bem], ["fab", fab]] as const) {
    const addrs = [...m.keys()];
    for (let i = 0; i < addrs.length; i += 50) {
      const part = addrs.slice(i, i + 50);
      const got = await Promise.all(
        part.map(async (a) => {
          for (let k = 0; k < 10; k++) {
            try {
              return (await clients[k % clients.length]!.readContract({ address: TOKENS[name].address, abi: erc20Abi, functionName: "balanceOf", args: [a as Address], blockNumber: block })) as bigint;
            } catch {
              await sleep(500 * (k + 1));
            }
          }
          throw new Error(`balanceOf ${a} kept failing`);
        }),
      );
      part.forEach((a, j) => {
        if (got[j] !== m.get(a)) throw new Error(`${name} balance of ${a} rebuilt as ${m.get(a)} but the token says ${got[j]}`);
      });
    }
    const sum = [...m.values()].reduce((s, v) => s + v, 0n);
    const supply = (await c.readContract({ address: TOKENS[name].address, abi: erc20Abi, functionName: "totalSupply", blockNumber: block })) as bigint;
    if (sum !== supply) throw new Error(`${name}: rebuilt balances sum to ${sum} but totalSupply is ${supply}`);
    console.log(`${name}: ${m.size} holders, balances sum to totalSupply ${supply}`);
  }
  // one leaf per wallet at or above either minimum (the contract checks the minimums again)
  const bemMin = BigInt(Math.round(Number(arg("bem-min", "0.1")) * 1e8));
  const fabMin = BigInt(Math.round(Number(arg("fab-min", "10")) * 1e8));
  const wallets = [...new Set([...bem.keys(), ...fab.keys()])]
    .filter((a) => a !== "0x000000000000000000000000000000000000dead" && ((bem.get(a) ?? 0n) >= bemMin || (fab.get(a) ?? 0n) >= fabMin))
    .sort();
  const entries = wallets.map((a) => [a, (bem.get(a) ?? 0n).toString(), (fab.get(a) ?? 0n).toString()]);
  const tree = StandardMerkleTree.of(entries, ["address", "uint256", "uint256"]);
  writeFileSync(out, JSON.stringify({ block: block.toString(), bemMin: bemMin.toString(), fabMin: fabMin.toString(), root: tree.root, entries }) + "\n");
  console.log(`snapshot at block ${block}: ${entries.length} wallets at or above the minimums, root ${tree.root}, written to ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
