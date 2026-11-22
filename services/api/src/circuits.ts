/**
 * Circuits Lingxi has taped out (H10): every circuit on Lingxi's processor is an ERC-721 token minted when it is taped
 * out, so its mint (a Transfer from the zero address) dates it. The counter walks the processor's mints from its deploy
 * block in the same 100-block windows as the other walkers, keeps its place in a file, and says how many were minted
 * in all and since a time. The page's total is the processor's own `nextId - 1`; this count must equal it.
 */

import { type Address, type PublicClient, createPublicClient, http, parseAbiItem } from "viem";
import { WINDOW } from "./indexer";
import { hasStore, readStore, saveJson } from "./durable";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const ZERO = "0x0000000000000000000000000000000000000000";

interface Stored {
  /** the processor and the block this walk started from: a saved place from another walk is never resumed */
  processor: string;
  from: number;
  next: number;
  /** each circuit's mint: [id, block, time in seconds] */
  mints: Array<[string, number, number]>;
}

export function createCircuitCounter(opts: { rpc: string; processor: Address; fromBlock: number; store?: string; client?: PublicClient; paceMs?: number }) {
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

  return {
    catchUp,
    /** circuits minted in all and since `sinceSec`, and the block the walk has read to */
    totals: (sinceSec: number) => ({ minted: data.mints.length, since: data.mints.filter((m) => m[2] >= sinceSec).length, indexedTo: data.next - 1 }),
  };
}
export type CircuitCounter = ReturnType<typeof createCircuitCounter>;
