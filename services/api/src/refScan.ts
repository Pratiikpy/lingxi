/**
 * "Used by others" (H6): circuits on other TapeOut processors whose netlists REF a Lingxi circuit, counted from chain.
 * Every processor TapeOut's factory has made is walked; each new circuit's netlist is read (in small batches) and its
 * REF records checked for Lingxi's processor. Progress is kept per processor, so each pass reads only the circuits made
 * since the last one. Lingxi's own processor is skipped: a bred child REFs its parents there, which is not someone else.
 */

import { type Address, type Hex, type PublicClient, createPublicClient, http, parseAbi } from "viem";
import { xLayer } from "@lingxi/chain";
import { hasStore, readStore, saveJson } from "./durable";

const factoryAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256 i) view returns (address)"]);
const processorAbi = parseAbi(["function nextId() view returns (uint256)", "function netlist(uint256 id) view returns (bytes)"]);
/** Netlists read in one call (X Layer's public RPCs limit how much one request may do). */
const BATCH = 20;
/** Circuits read in one pass, so a pass is short and the job loop stays responsive. */
const PER_PASS = 400;

/** The REF records in a TapeOut netlist: NAND (op 1, two u24), LATCH (op 3, one u24), REF (op 2, cpu, u64 id, nIns, nOuts, nIns u24). */
export function refTargets(netlist: Hex | string): Array<{ cpu: string; id: bigint }> {
  const h = netlist.startsWith("0x") ? netlist.slice(2) : netlist;
  const byte = (i: number) => parseInt(h.slice(2 * i, 2 * i + 2), 16);
  const n = h.length / 2;
  const out: Array<{ cpu: string; id: bigint }> = [];
  let p = 0;
  while (p < n) {
    const op = byte(p);
    if (op === 1) p += 7;
    else if (op === 3) p += 4;
    else if (op === 2) {
      if (p + 31 > n) return out;
      const cpu = `0x${h.slice(2 * (p + 1), 2 * (p + 21))}`.toLowerCase();
      const id = BigInt(`0x${h.slice(2 * (p + 21), 2 * (p + 29))}`);
      const nIns = byte(p + 29);
      out.push({ cpu, id });
      p += 31 + 3 * nIns;
    } else return out;
  }
  return out;
}

interface Stored {
  /** every processor the factory has made, in its order (a processor never moves, so each is read once) */
  cpus?: string[];
  /** per processor: the next circuit id to read */
  next: Record<string, number>;
  refs: Array<{ cpu: string; id: number; target: number }>;
  cpuCount: number;
}

export function createRefScanner(o: { rpc?: string; client?: PublicClient; factory: Address; ours: Address; store?: string }) {
  // X Layer's chain definition carries the Multicall3 address the batched reads go through
  const pub = o.client ?? (createPublicClient({ chain: xLayer, transport: http(o.rpc, { timeout: 20_000, retryCount: 1 }) }) as PublicClient);
  const ours = o.ours.toLowerCase();
  let data: Stored = { next: {}, refs: [], cpuCount: 0 };
  if (o.store && hasStore(o.store)) {
    try {
      data = readStore(o.store) as Stored;
    } catch {
      // a damaged store starts the walk again
    }
  }
  let complete = false;
  let running = false;
  const save = () => o.store && saveJson(o.store, undefined, JSON.stringify(data));

  async function catchUp(): Promise<void> {
    if (running) return;
    running = true;
    try {
      let budget = PER_PASS;
      const count = Number(await pub.readContract({ address: o.factory, abi: factoryAbi, functionName: "cpuCount" }));
      data.cpuCount = count;
      // only the processors made since the last pass are looked up
      const cpus = data.cpus ?? [];
      for (let i = cpus.length; i < count; i += BATCH) {
        const idx = Array.from({ length: Math.min(BATCH, count - i) }, (_, k) => i + k);
        const got = await pub.multicall({ allowFailure: false, contracts: idx.map((k) => ({ address: o.factory, abi: factoryAbi, functionName: "cpuAt" as const, args: [BigInt(k)] })) });
        cpus.push(...got.map((a) => String(a).toLowerCase()));
      }
      data.cpus = cpus;
      // every other processor's latest circuit id, in batches: `nextId` names its newest circuit (ids start at 1, so a
      // processor with three circuits answers 3; read back on mainnet, C1), and a processor that does not answer is
      // left unfinished rather than taken for empty
      const others = cpus.filter((c) => c !== ours) as Address[];
      const latestIds = new Map<string, number>();
      for (let i = 0; i < others.length; i += BATCH) {
        const part = others.slice(i, i + BATCH);
        const got = await pub.multicall({ allowFailure: true, contracts: part.map((cpu) => ({ address: cpu, abi: processorAbi, functionName: "nextId" as const })) });
        got.forEach((g, k) => g.status === "success" && latestIds.set(part[k]!, Number(g.result)));
      }
      let behind = false;
      for (const cpu of others) {
        const latest = latestIds.get(cpu);
        if (latest === undefined) {
          behind = true;
          continue;
        }
        // the next circuit to read; every id up to and including the latest is read
        let from = data.next[cpu] ?? 1;
        while (from <= latest && budget > 0) {
          const ids = Array.from({ length: Math.min(BATCH, latest - from + 1, budget) }, (_, k) => from + k);
          const got = await pub.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: cpu, abi: processorAbi, functionName: "netlist" as const, args: [BigInt(id)] })) });
          // stop at the first netlist that could not be read: it is read again next pass, never stepped past
          let read = 0;
          for (const [k, g] of got.entries()) {
            if (g.status !== "success") break;
            for (const t of refTargets(g.result as Hex)) if (t.cpu === ours) data.refs.push({ cpu, id: ids[k]!, target: Number(t.id) });
            read++;
          }
          from += read;
          budget -= ids.length;
          if (read < ids.length) break;
        }
        data.next[cpu] = from;
        if (from <= latest) behind = true;
      }
      complete = !behind && budget > 0;
      save();
    } finally {
      running = false;
    }
  }

  return {
    catchUp,
    list: () => data.refs.map((r) => ({ ...r })),
    totals: () => ({
      circuits: data.refs.length,
      processors: new Set(data.refs.map((r) => r.cpu)).size,
      /** other processors read so far, of cpuCount in all (Lingxi's own among them, skipped) */
      scannedProcessors: Object.keys(data.next).length,
      cpuCount: data.cpuCount,
      complete,
    }),
  };
}

export type RefScanner = ReturnType<typeof createRefScanner>;
