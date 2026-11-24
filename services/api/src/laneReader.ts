/** Reads every processor in TapeOut's X Layer factory with multicall: how many circuits each has made. */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { FACTORY, xLayer } from "@lingxi/chain";
import type { TapeoutReader } from "./lane";

const factoryAbi = parseAbi([
  "function cpuCount() view returns (uint256)",
  "function cpuAt(uint256) view returns (address)",
]);
const cpuAbi = parseAbi(["function nextId() view returns (uint256)"]);

type Answer = { status: "success"; result: bigint } | { status: "failure"; error: Error };

/**
 * Every processor's circuits, summed (C1): a processor's `nextId` is the id of its latest circuit (ids start at 1, so
 * it is the count itself; read back on mainnet). A processor whose count could not be read this time keeps the count it
 * last had, so a slow node never makes the day's total drop.
 */
export function circuitsTotal(
  cpus: readonly string[],
  answers: readonly Answer[],
  known: Map<string, number>,
): { total: number; complete: boolean } {
  cpus.forEach((cpu, k) => {
    const a = answers[k];
    if (a?.status === "success") known.set(cpu, Number(a.result));
  });
  // a processor never read yet would count as empty and then jump once read: the reading says it is incomplete
  return {
    total: cpus.reduce((n, cpu) => n + (known.get(cpu) ?? 0), 0),
    complete: cpus.every((cpu) => known.has(cpu)),
  };
}

export function factoryReader(rpc: string): TapeoutReader {
  const pub = createPublicClient({
    chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } },
    transport: http(rpc, { timeout: 30_000 }),
    batch: { multicall: { batchSize: 4096 } },
  });
  let cpus: Address[] = [];
  const known = new Map<string, number>();
  return async () => {
    const count = Number(await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "cpuCount" }));
    // processors only ever get added: read the addresses of new ones
    if (cpus.length < count) {
      const fresh = await pub.multicall({
        allowFailure: false,
        contracts: Array.from(
          { length: count - cpus.length },
          (_, k) =>
            ({ address: FACTORY, abi: factoryAbi, functionName: "cpuAt", args: [BigInt(cpus.length + k)] }) as const,
        ),
      });
      cpus = [...cpus, ...(fresh as Address[])];
    }
    const next = await pub.multicall({
      allowFailure: true,
      contracts: cpus.map((address) => ({ address, abi: cpuAbi, functionName: "nextId" }) as const),
    });
    const { total, complete } = circuitsTotal(cpus, next as Answer[], known);
    return { total, processors: count, complete };
  };
}
