/** Reads every processor in TapeOut's X Layer factory with multicall: how many circuits each has made. */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { FACTORY, xLayer } from "@lingxi/chain";
import type { TapeoutReader } from "./lane";

const factoryAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const cpuAbi = parseAbi(["function nextId() view returns (uint256)"]);

export function factoryReader(rpc: string): TapeoutReader {
  const pub = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc, { timeout: 30_000 }), batch: { multicall: { batchSize: 4096 } } });
  let cpus: Address[] = [];
  return async () => {
    const count = Number(await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "cpuCount" }));
    // processors only ever get added: read the addresses of new ones
    if (cpus.length < count) {
      const fresh = await pub.multicall({ allowFailure: false, contracts: Array.from({ length: count - cpus.length }, (_, k) => ({ address: FACTORY, abi: factoryAbi, functionName: "cpuAt", args: [BigInt(cpus.length + k)] }) as const) });
      cpus = [...cpus, ...(fresh as Address[])];
    }
    const next = await pub.multicall({ allowFailure: true, contracts: cpus.map((address) => ({ address, abi: cpuAbi, functionName: "nextId" }) as const) });
    const total = next.reduce((n, r) => n + (r.status === "success" ? Math.max(0, Number(r.result) - 1) : 0), 0);
    return { total, processors: count };
  };
}
