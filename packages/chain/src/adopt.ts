/**
 * Reading an outside brain from X Layer (PRD Z7, X1): any circuit taped out on a
 * registered TapeOut processor, by processor and circuit number. Circuits that
 * REF other circuits are followed (to a limit), and every processor on the way
 * must be one TapeOut's factory registered, so nothing here runs an unknown
 * contract's idea of a netlist. The bytes are returned so a game can keep them
 * and rebuild the circuit offline.
 */

import type { Address, PublicClient } from "viem";
import { type Circuit, type CircuitPart, circuitFromParts, decode, refKey } from "@lingxi/brain";

export { type CircuitPart, circuitFromParts } from "@lingxi/brain";
import { FACTORY, factoryAbi, processorAbi } from "./tapeout";

/** The most a pet will carry: enough for any brain in the game, small enough for a phone. */
export const ADOPT_MAX_GATES = 20_000;
/** How deep REFs are followed, and how many circuits one brain may pull in. */
export const ADOPT_MAX_DEPTH = 4;
export const ADOPT_MAX_PARTS = 24;

export interface OutsideCircuit {
  processor: string;
  id: string;
  owner: string;
  nIn: number;
  nOut: number;
  nState: number;
  gates: number;
  /** the circuit itself first, then every circuit it REFs */
  parts: CircuitPart[];
}

export class AdoptError extends Error {
  constructor(readonly reason: "notProcessor" | "noCircuit" | "tooDeep" | "tooBig" | "illFormed") {
    super(reason);
  }
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** Read a circuit and everything it REFs from the chain. */
export async function readOutsideCircuit(pub: PublicClient, processor: Address, id: bigint): Promise<OutsideCircuit> {
  const registered = new Map<string, boolean>();
  const isCPU = async (cpu: string) => {
    const k = cpu.toLowerCase();
    if (!registered.has(k)) registered.set(k, (await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCPU", args: [cpu as Address] })) as boolean);
    return registered.get(k)!;
  };
  if (!(await isCPU(processor))) throw new AdoptError("notProcessor");

  const parts: CircuitPart[] = [];
  const seen = new Set<string>();
  const fetchPart = async (cpu: string, cid: bigint, depth: number): Promise<void> => {
    const key = refKey(cpu, cid);
    if (seen.has(key)) return;
    if (depth > ADOPT_MAX_DEPTH) throw new AdoptError("tooDeep");
    if (parts.length >= ADOPT_MAX_PARTS) throw new AdoptError("tooBig");
    if (depth > 0 && !(await isCPU(cpu))) throw new AdoptError("notProcessor");
    seen.add(key);
    let info: readonly [bigint, bigint, bigint, bigint];
    let bytes: `0x${string}`;
    try {
      info = (await pub.readContract({ address: cpu as Address, abi: processorAbi, functionName: "circuitInfo", args: [cid] })) as readonly [bigint, bigint, bigint, bigint];
      bytes = (await pub.readContract({ address: cpu as Address, abi: processorAbi, functionName: "netlist", args: [cid] })) as `0x${string}`;
    } catch {
      throw new AdoptError("noCircuit");
    }
    if (info[3] > BigInt(ADOPT_MAX_GATES)) throw new AdoptError("tooBig");
    const data = fromHex(bytes);
    if (!data.length) throw new AdoptError("noCircuit");
    parts.push({ processor: cpu.toLowerCase(), id: cid.toString(), nIn: Number(info[0]), nOut: Number(info[1]), hex: toHex(data) });
    let els;
    try {
      els = decode(data, Number(info[0]));
    } catch {
      throw new AdoptError("illFormed");
    }
    for (const e of els) if ("cpu" in e && e.cpu && e.id !== undefined) await fetchPart(e.cpu as string, e.id as bigint, depth + 1);
  };
  await fetchPart(processor, id, 0);

  let circuit: Circuit;
  try {
    circuit = circuitFromParts(parts);
  } catch {
    throw new AdoptError("illFormed");
  }
  if (circuit.nGates > ADOPT_MAX_GATES) throw new AdoptError("tooBig");
  const owner = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "ownerOf", args: [id] }).catch(() => "")) as string;
  return { processor: processor.toLowerCase(), id: id.toString(), owner, nIn: circuit.nIn, nOut: circuit.nOut, nState: circuit.nState, gates: circuit.nGates, parts };
}
