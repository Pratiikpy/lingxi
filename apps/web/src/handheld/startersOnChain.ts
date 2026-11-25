/**
 * The starters recorded in the handheld's firmware, compared with X Layer's own (A59; P7: out of HandheldApp). The
 * firmware checks itself against the record it was built with; here, where X Layer can be read, the record is held to
 * the chain: each starter circuit's netlist read from the processor and hashed.
 */
import { useEffect, useState } from "react";
import { type Hex, keccak256 } from "viem";
import { processorAbi } from "@lingxi/chain";
import { deployment } from "../game/chain";
import { proofClient } from "../game/proofRpc";
import { RECORDED_STARTERS } from "@lingxi/handheld";

export type StartersOnChain = "reading" | "match" | "unread" | "differ";

export function useStartersOnChain(): StartersOnChain {
  const [onChain, setOnChain] = useState<StartersOnChain>("reading");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (!deployment) throw new Error("no deployment");
        const pc = proofClient(0);
        const lines = ["gentle", "bold", "curious"] as const;
        const read = await Promise.all(
          lines.map(async (l) =>
            keccak256(
              (await pc.readContract({
                address: deployment!.processor,
                abi: processorAbi,
                functionName: "netlist",
                args: [BigInt(deployment!.circuits[l]!.id)],
              })) as Hex,
            ),
          ),
        );
        if (live)
          setOnChain(read.every((h, i) => h.toLowerCase() === RECORDED_STARTERS[lines[i]!]) ? "match" : "differ");
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
