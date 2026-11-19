/**
 * A24: what a child's lineage on chain says, and no more. The Breeder checks, before a child hatches, that its circuit
 * is its two parents' child, and PetRegistry keeps the parents for good; but the owner can give the child another
 * brain later (`setBrain`), and the parents stay. So the parents are where it came from; whether its brain today is
 * still the circuit checked at birth is read from the chain: the brain it hatched with against the brain it has now.
 */
import type { PetHistoryRecord } from "./indexer";

/** "kept": its brain is still the circuit checked at birth; "changed": it has had another since; null: not a child. */
export function lineageNow(h: PetHistoryRecord, brainNow: string): "kept" | "changed" | null {
  if (!h.parents || !h.hatched) return null;
  return h.hatched.brainId === brainNow ? "kept" : "changed";
}
