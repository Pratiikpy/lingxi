/**
 * Ids read from a mined transaction's own events. A simulation answers for the state it was run against; between it
 * and the block, someone else's transaction can take the id it returned, so a simulated id is never stored.
 */

import { type Address, type TransactionReceipt, decodeEventLog, parseAbi } from "viem";
import { petRegistryAbi } from "./registryAbi";

const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The circuit a tape-out minted: the processor's ERC-721 Transfer from 0x0 to `to`. */
export function circuitIdFrom(receipt: TransactionReceipt, processor: Address, to: Address): bigint {
  if (receipt.status !== "success") throw new Error("the tape-out reverted");
  const ids: bigint[] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, processor)) continue;
    try {
      const e = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics });
      if (e.eventName === "Transfer" && same(e.args.from, ZERO) && same(e.args.to, to)) ids.push(e.args.tokenId);
    } catch {
      // another of the processor's events
    }
  }
  if (ids.length > 1) throw new Error("the tape-out minted more than one circuit");
  if (!ids.length) throw new Error("no circuit minted to us in this transaction");
  return ids[0]!;
}

/** The pet a hatch created: the registry's Hatched event for `to`. */
export function hatchedPetIdFrom(receipt: TransactionReceipt, registry: Address, to: Address): bigint {
  if (receipt.status !== "success") throw new Error("the hatch reverted");
  for (const log of receipt.logs) {
    if (!same(log.address, registry)) continue;
    try {
      const e = decodeEventLog({ abi: petRegistryAbi, data: log.data, topics: log.topics });
      if (e.eventName === "Hatched" && same(e.args.to, to)) return e.args.petId;
    } catch {
      // another of the registry's events
    }
  }
  throw new Error("no pet hatched for us in this transaction");
}
