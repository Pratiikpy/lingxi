/**
 * Proving a season entry is a pet on X Layer, so it may win the keepsake: a keeper of the pet signed this exact entry
 * (see @lingxi/chain relayAuth.ts, kind "season"), and the card it enters thinks exactly as the pet's brain on chain:
 * the same answer and the same memory for all 65,536 inputs. The brain is compared by what it does, so a plain
 * brain, a child of two parents and a brain with an owned instinct are all checked the same way.
 */

import type { Address } from "viem";
import type { Circuit, StarterLine } from "@lingxi/brain";
import type { MindCheck } from "./mindCheck";
import type { SignedRelay } from "@lingxi/chain";
import { type Brain, type PetCard, mindBrain, parseCard } from "@lingxi/game";
import { type NonceBook, type RelayRefusal, checkRelayAuth } from "./relayGate";

export type SeasonProofRefusal = RelayRefusal | "notThisEntry" | "notItsBrain" | "unreadable" | "busy";

const LINES = ["gentle", "bold", "curious"] as const;

/** What the proof reads of an entry: its line and its card. Null when either is missing or not one the game makes. */
function mindOf(pet: unknown): { line: StarterLine; card: PetCard } | null {
  if (typeof pet !== "object" || pet === null || !("line" in pet) || !("card" in pet) || typeof pet.card !== "string")
    return null;
  const line = LINES.find((l) => l === pet.line);
  const card = parseCard(pet.card);
  return line && card ? { line, card } : null;
}

/** Same answers and same memory for every input word, from empty memory and from `memory`. */
export function sameBrain(a: Brain, b: Brain, memory?: readonly number[]): boolean {
  if (a.nState !== b.nState) return false;
  const starts = [new Array<number>(a.nState).fill(0), ...(memory && memory.length === a.nState ? [memory] : [])];
  for (const start of starts) {
    for (let w = 0; w < 1 << 16; w++) {
      const x = Uint8Array.from(start);
      const y = Uint8Array.from(start);
      if (a.fast.step(x, w) !== b.fast.step(y, w)) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    }
  }
  return true;
}

export async function proveSeasonEntry(
  pet: unknown,
  proof: SignedRelay,
  deps: {
    isKeeper: (petId: string, who: Address) => Promise<boolean>;
    brainOf: (petId: string) => Promise<Brain>;
    now: () => number;
    nonces: NonceBook;
    /** the server's way (A62): the pet's circuit read here, the comparison run off the request thread */
    circuitOf?: (petId: string) => Promise<Circuit>;
    check?: MindCheck;
  },
): Promise<{ ok: true; petId: string } | { ok: false; reason: SeasonProofRefusal }> {
  // the signature covers the entry as sent, so a proof cannot be lifted onto another pet's card
  if (proof?.kind !== "season" || proof.payload !== JSON.stringify(pet)) return { ok: false, reason: "notThisEntry" };
  const auth = await checkRelayAuth(proof, deps);
  if (!auth.ok) return auth;
  const mind = mindOf(pet);
  if (!mind) return { ok: false, reason: "notItsBrain" };
  const { line, card } = mind;
  if (deps.circuitOf && deps.check) {
    let circuit: Circuit;
    try {
      circuit = await deps.circuitOf(proof.petId);
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    const v = await deps.check(circuit, line, card);
    if (v === "busy" || v === "slow") return { ok: false, reason: "busy" };
    return v === "same" ? { ok: true, petId: proof.petId } : { ok: false, reason: "notItsBrain" };
  }
  let onChain: Brain;
  try {
    onChain = await deps.brainOf(proof.petId);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const mine = mindBrain({
    line,
    lessons: card.lessons,
    family: card.family,
    instincts: card.instincts,
    outside: card.outside,
    growth: card.growth,
  });
  return sameBrain(onChain, mine, card.memory)
    ? { ok: true, petId: proof.petId }
    : { ok: false, reason: "notItsBrain" };
}
