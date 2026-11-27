/**
 * The starters recorded in the handheld's firmware, compared with X Layer's own (A59; P7: out of HandheldApp). The
 * firmware checks itself against the record it was built with; here, where X Layer can be read, the record is held to
 * the chain: each starter circuit's netlist read from the processor and hashed.
 */
import { useEffect, useState } from "react";
import { type Hex, keccak256 } from "viem";
import { type Deployment, processorAbi } from "@lingxi/chain";
import { deployment } from "../game/network";
import { proofClient } from "../game/proofRpc";
import { RECORDED_STARTERS } from "@lingxi/handheld";

/** A starter line's circuit id in the deployment record; a record without it is said to be the problem. */
const starterOf = (d: Deployment, line: string): string => {
  const c = d.circuits[line];
  if (!c) throw new Error(`the deployment record has no ${line} starter`);
  return c.id;
};

export type StartersOnChain = "reading" | "match" | "unread" | "differ";

export function useStartersOnChain(): StartersOnChain {
  const [onChain, setOnChain] = useState<StartersOnChain>("reading");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const d = deployment;
        if (!d) throw new Error("no deployment");
        const pc = proofClient(0);
        const lines = ["gentle", "bold", "curious"] as const;
        const read = await Promise.all(
          lines.map(async (l) =>
            keccak256(
              (await pc.readContract({
                address: d.processor,
                abi: processorAbi,
                functionName: "netlist",
                args: [BigInt(starterOf(d, l))],
              })) as Hex,
            ),
          ),
        );
        if (live)
          setOnChain(lines.every((l, i) => read[i]?.toLowerCase() === RECORDED_STARTERS[l]) ? "match" : "differ");
      } catch {
        if (live) setOnChain("unread");
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return onChain;
}
