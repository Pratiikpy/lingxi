/**
 * Circuits Lingxi has taped out (H10): every circuit on Lingxi's processor is an ERC-721 token minted when it is taped
 * out, so its mint (a Transfer from the zero address) dates it. The counter walks the processor's mints from its deploy
 * block in the same 100-block windows as the other walkers, keeps its place in a file, and says how many were minted
 * in all and since a time. The page's total is the processor's own `nextId` (the id of its latest circuit, ids starting
 * at 1); walked from the deploy block, this count must equal it.
 */

import { type Address, type PublicClient, createPublicClient, http, parseAbiItem } from "viem";
import { WINDOW } from "./indexer";
import { hasStore, readStore, saveJson } from "./durable";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const NEXT_ID = parseAbiItem("function nextId() view returns (uint256)");
const ZERO = "0x0000000000000000000000000000000000000000";

interface Stored {
  /** the processor and the block this walk started from: a saved place from another walk is never resumed */
  processor: string;
  from: number;
  next: number;
  /** each circuit's mint: [id, block, time in seconds] */
  mints: Array<[string, number, number]>;
}

/**
 * `fromBlock` is where the walk of mints starts; `deployBlock` is the processor's deployment (the same unless the walk is
 * told to start later, as LINGXI_PROCESSOR_FROM does). The week's count searches from the deployment, so a walk that
 * starts after the week began still counts only the week's circuits (P3a).
 */
export function createCircuitCounter(opts: { rpc: string; processor: Address; fromBlock: number; deployBlock?: number; store?: string; client?: PublicClient; paceMs?: number }) {
  const deployBlock = Math.min(opts.deployBlock ?? opts.fromBlock, opts.fromBlock);
  const pub = opts.client ?? (createPublicClient({ transport: http(opts.rpc, { timeout: 20_000, retryCount: 0 }) }) as PublicClient);
  const start = (): Stored => ({ processor: opts.processor.toLowerCase(), from: opts.fromBlock, next: opts.fromBlock, mints: [] });
  let data = start();
  if (opts.store && hasStore(opts.store)) {
    try {
      const held = readStore(opts.store) as Partial<Stored>;
      // a place saved by a walk of another processor, or one started from another block (a fork of the chain starts at
      // its own block, so its mints before that were never read), would give a wrong count: start again instead
      if (held.processor === data.processor && held.from === opts.fromBlock && typeof held.next === "number" && Array.isArray(held.mints)) data = held as Stored;
    } catch {
      // a damaged file starts again from the deploy block
    }
  }
  const save = () => {
    if (opts.store) saveJson(opts.store, undefined, JSON.stringify(data));
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let running = false;

  async function catchUp(maxWindows = 400): Promise<void> {
    if (running) return;
    running = true;
    try {
      // the head as it is now, not one viem read moments ago
      const head = Number(await pub.getBlockNumber({ cacheTime: 0 }));
      for (let i = 0; i < maxWindows && data.next <= head; i++) {
        const to = Math.min(head, data.next + WINDOW - 1);
        let logs;
        for (let attempt = 0; ; attempt++) {
          try {
            logs = await pub.getLogs({ address: opts.processor, event: TRANSFER, args: { from: ZERO }, fromBlock: BigInt(data.next), toBlock: BigInt(to) });
            break;
          } catch (e) {
            if (attempt >= 6) throw e;
            await sleep(2000 * (attempt + 1));
          }
        }
        for (const l of logs) {
          const a = l.args as { from: string; tokenId: bigint };
          // the query asks for mints only; a node that ignores the filter still cannot add a transfer here
          if (String(a.from).toLowerCase() !== ZERO) continue;
          const block = Number(l.blockNumber);
          const time = Number((await pub.getBlock({ blockNumber: BigInt(block) })).timestamp);
          data.mints.push([String(a.tokenId), block, time]);
        }
        data.next = to + 1;
        await sleep(opts.paceMs ?? 300);
        if (logs.length || i % 50 === 49) save();
      }
      save();
    } finally {
      running = false;
    }
  }

  /** The first block at or after `sinceSec`, searched by its time between the deploy block and the head. */
  async function firstBlockSince(sinceSec: number, head: number): Promise<number> {
    const timeOf = async (b: number) => Number((await pub.getBlock({ blockNumber: BigInt(b) })).timestamp);
    let lo = deployBlock;
    let hi = head;
    if ((await timeOf(lo)) >= sinceSec) return lo;
    while (lo + 1 < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await timeOf(mid)) >= sinceSec) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  const nextIdAt = async (b: number) => Number(await pub.readContract({ address: opts.processor, abi: [NEXT_ID], functionName: "nextId", blockNumber: BigInt(b) }));

  /**
   * Circuits taped out since `sinceSec`, from the processor's own count (C7): `nextId` is the id of its latest circuit, so
   * the window's circuits are `nextId` at the head less `nextId` just before the window's first block (none before the
   * processor existed). Two state reads and a search by block time, so the figure never waits on the walk of mints, which
   * a restart sends back to the deploy block; the walk stays as the recount's independent count.
   */
  async function week(sinceSec: number): Promise<number> {
    const head = Number(await pub.getBlockNumber({ cacheTime: 0 }));
    const first = await firstBlockSince(sinceSec, head);
    const before = first <= deployBlock ? 0 : await nextIdAt(first - 1);
    return (await nextIdAt(head)) - before;
  }

  return {
    catchUp,
    week,
    /** circuits minted in all and since `sinceSec`, and the block the walk has read to */
    totals: (sinceSec: number) => ({ minted: data.mints.length, since: data.mints.filter((m) => m[2] >= sinceSec).length, indexedTo: data.next - 1 }),
  };
}
export type CircuitCounter = ReturnType<typeof createCircuitCounter>;
