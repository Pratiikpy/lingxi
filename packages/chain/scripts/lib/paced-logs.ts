/**
 * Reading many 100-block log windows from X Layer without being refused. X Layer caps `eth_getLogs` at 100
 * blocks on every endpoint, so a long range is hundreds of calls; this spreads them over several endpoints in
 * parallel lanes, spacing each endpoint's requests to the rate it sustains (measured: dRPC about 7 a second, the
 * two official endpoints one or two). A refusal widens that endpoint's spacing; a run of successes narrows it
 * back. A window that fails on its lane's endpoint moves to the next endpoint after four tries.
 */

import { type Address, type Hex, createPublicClient, http, toHex } from "viem";
import { xLayer } from "../../src/tapeout";

/** A raw log as `eth_getLogs` returns it: decoding is the caller's, so each script keeps its own reading. */
export interface RawLog {
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
}

export interface Endpoint {
  url: string;
  /** requests per second it sustains */
  rate: number;
  /** parallel lanes that start on it */
  lanes: number;
}

/** X Layer mainnet's public endpoints, with the rates and lanes measured for the holder snapshot. */
export const XLAYER_ENDPOINTS: Endpoint[] = [
  { url: "https://xlayer.drpc.org", rate: 7, lanes: 14 },
  { url: "https://rpc.xlayer.tech", rate: 1.5, lanes: 1 },
  { url: "https://xlayerrpc.okx.com", rate: 1.5, lanes: 1 },
];

export const WINDOW = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createPacedLogs(endpoints: Endpoint[]) {
  const clients = endpoints.map((e) => createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [e.url] } } }, transport: http(e.url, { timeout: 30_000 }) }));
  const laneEndpoint = endpoints.flatMap((e, i) => Array.from({ length: e.lanes }, () => i));
  const gap = endpoints.map((e) => 1000 / e.rate);
  const nextAt = endpoints.map(() => 0);
  async function slot(i: number) {
    const now = Date.now();
    const at = Math.max(now, nextAt[i]!);
    nextAt[i] = at + gap[i]!;
    if (at > now) await sleep(at - now);
  }

  /** One window of at most 100 blocks, all logs of `address` (optionally only those with `topic0`). */
  async function window(address: Address, from: number, to: number, lane: number, topic0?: Hex): Promise<RawLog[]> {
    if (to - from + 1 > WINDOW) throw new Error(`a window is at most ${WINDOW} blocks`);
    for (let attempt = 0; attempt < 40; attempt++) {
      const i = (laneEndpoint[lane % laneEndpoint.length]! + Math.floor(attempt / 4)) % clients.length;
      await slot(i);
      try {
        const logs = (await clients[i]!.request({
          method: "eth_getLogs",
          params: [{ address, fromBlock: toHex(from), toBlock: toHex(to), ...(topic0 ? { topics: [topic0] } : {}) }],
        })) as RawLog[];
        gap[i] = Math.max(1000 / endpoints[i]!.rate, gap[i]! * 0.98);
        return logs;
      } catch {
        gap[i] = Math.min(5000, gap[i]! * 1.5);
      }
    }
    throw new Error(`window ${from}-${to} kept failing`);
  }

  /** Every log of `address` from `from` to `to` inclusive, in block order, read over all lanes at once. */
  async function range(address: Address, from: number, to: number, topic0?: Hex): Promise<RawLog[]> {
    const starts: number[] = [];
    for (let a = from; a <= to; a += WINDOW) starts.push(a);
    const results: RawLog[][] = new Array(starts.length);
    let next = 0;
    await Promise.all(
      laneEndpoint.map(async (_, lane) => {
        while (next < starts.length) {
          const k = next++;
          const a = starts[k]!;
          results[k] = await window(address, a, Math.min(to, a + WINDOW - 1), lane, topic0);
        }
      }),
    );
    return results.flat();
  }

  return { window, range, lanes: laneEndpoint.length };
}
