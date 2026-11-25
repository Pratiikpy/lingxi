/**
 * Anchoring a pet's replay to X Layer. A pet's log hash commits to every input word since it hatched, but not to which
 * brain read each word: the log file says that, and the log file comes from its owner. This proves the brains instead.
 *
 *   - the first brain is the one in the pet's own Hatched event, and so is its starting memory;
 *   - each later brain is the one in a BrainChanged event for this pet, in block order;
 *   - the last is the brain on record now, and no proven change is left out between them.
 *
 * Which transactions to read are hints (from the indexer or the log file). Each is read back from its receipt on
 * X Layer and kept only if the registry itself emitted the event, for this pet, in a transaction that succeeded.
 */

import { type Address, type Hex, type PublicClient, decodeEventLog } from "viem";
import { petRegistryAbi } from "./registryAbi";

export interface BrainAnchor {
  brainId: bigint;
  tx: Hex;
  block: bigint;
  kind: "hatched" | "changed";
}

export type AnchorFailure = "noHatch" | "hatchBrain" | "unanchored" | "skipsChange" | "notCurrent";

export type AnchorResult =
  // the hatching is always the first anchor, so there is at least one
  | { ok: true; anchors: [BrainAnchor, ...BrainAnchor[]]; startState: bigint }
  | { ok: false; reason: AnchorFailure; detail: string };

export interface AnchorHints {
  /** the transaction that hatched (or bred) the pet */
  hatched: Hex;
  /** transactions that changed its brain, in any order */
  changes: readonly Hex[];
}

interface Found {
  kind: "hatched" | "changed";
  petId: bigint;
  brainId: bigint;
  state?: bigint;
  block: bigint;
  tx: Hex;
}

/** The registry's own Hatched or BrainChanged events in one transaction, or nothing if it cannot be read or reverted. */
async function eventsIn(pub: PublicClient, registry: Address, tx: Hex): Promise<Found[]> {
  let receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
  try {
    receipt = await pub.getTransactionReceipt({ hash: tx });
  } catch {
    return [];
  }
  if (receipt.status !== "success") return [];
  const found: Found[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: petRegistryAbi, data: log.data, topics: log.topics });
      if (e.eventName === "Hatched")
        found.push({
          kind: "hatched",
          petId: e.args.petId,
          brainId: e.args.brainId,
          state: e.args.state,
          block: receipt.blockNumber,
          tx,
        });
      else if (e.eventName === "BrainChanged")
        found.push({ kind: "changed", petId: e.args.petId, brainId: e.args.brainId, block: receipt.blockNumber, tx });
    } catch {
      // another event of the registry's
    }
  }
  return found;
}

/**
 * Proves that `brains`, the brains a replay used in order (consecutive repeats allowed), are the brains this pet held
 * on chain, in that order, ending with `current`.
 */
export async function anchorBrains(
  pub: PublicClient,
  registry: Address,
  petId: bigint,
  brains: readonly bigint[],
  hints: AnchorHints,
  current: bigint,
): Promise<AnchorResult> {
  const sequence = brains.filter((b, i) => i === 0 || b !== brains[i - 1]);
  if (!sequence.length) return { ok: false, reason: "unanchored", detail: "no brain to anchor" };

  const hatch = (await eventsIn(pub, registry, hints.hatched)).find((e) => e.kind === "hatched" && e.petId === petId);
  if (!hatch || hatch.state === undefined)
    return { ok: false, reason: "noHatch", detail: `no Hatched event for pet ${petId} in ${hints.hatched}` };
  if (hatch.brainId !== sequence[0])
    return {
      ok: false,
      reason: "hatchBrain",
      detail: `it hatched with brain ${hatch.brainId}, the replay starts with ${sequence[0]}`,
    };

  // every change the hints can prove, for this pet, oldest first
  const changes = (await Promise.all(hints.changes.map((tx) => eventsIn(pub, registry, tx))))
    .flat()
    .filter((e) => e.kind === "changed" && e.petId === petId && e.block >= hatch.block)
    .sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));

  const anchors: [BrainAnchor, ...BrainAnchor[]] = [
    { brainId: hatch.brainId, tx: hatch.tx, block: hatch.block, kind: "hatched" },
  ];
  let used = 0;
  for (const brain of sequence.slice(1)) {
    const at = changes.findIndex(
      (c, i) => i >= used && c.brainId === brain && c.block > anchors[anchors.length - 1]!.block,
    );
    if (at < 0)
      return {
        ok: false,
        reason: "unanchored",
        detail: `no BrainChanged to brain ${brain} after block ${anchors[anchors.length - 1]!.block}`,
      };
    // a proven change between the last anchor and this one means the replay left a brain out
    const skipped = changes.slice(used, at).find((c) => c.block > anchors[anchors.length - 1]!.block);
    if (skipped)
      return {
        ok: false,
        reason: "skipsChange",
        detail: `brain ${skipped.brainId} (block ${skipped.block}) is missing from the replay`,
      };
    const c = changes[at]!;
    anchors.push({ brainId: c.brainId, tx: c.tx, block: c.block, kind: "changed" });
    used = at + 1;
  }
  const later = changes.slice(used).find((c) => c.block > anchors[anchors.length - 1]!.block);
  if (later)
    return {
      ok: false,
      reason: "skipsChange",
      detail: `brain ${later.brainId} (block ${later.block}) came after the replay's last brain`,
    };
  if (anchors[anchors.length - 1]!.brainId !== current)
    return {
      ok: false,
      reason: "notCurrent",
      detail: `the replay ends with brain ${anchors[anchors.length - 1]!.brainId}, the pet's brain is ${current}`,
    };
  return { ok: true, anchors, startState: hatch.state };
}
