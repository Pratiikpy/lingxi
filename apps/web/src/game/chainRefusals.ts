/**
 * X Layer's refusals said in words a player can act on (P7: out of chain.ts): the registry's custom errors and the
 * Breeder's, read from the revert wherever viem put it.
 */
import { petRegistryAbi, refusesTokens, LineMismatchError, RevertedOnChain, revertName } from "@lingxi/chain";
import { firstLine } from "./errorText";

/** The registry's refusals the chain panel explains, by the contract's own error name (A19). */
export const REGISTRY_REFUSALS: Record<string, string> = {
  DayNotAfter: "alreadySaved",
  NotKeeper: "notKeeping",
  SittingTooLong: "badDays",
};

/**
 * What the chain panel says about a failed write: the contract's own reason when it gave one (read from the decoded
 * error, never from the message's first line, which is viem's "The contract function ... reverted."), else that
 * first line.
 */
export function chainReason(e: unknown): string {
  if (refusesTokens(e)) return "cannotReceive";
  if (e instanceof LineMismatchError) return "notThisPet";
  // sent, mined and turned down: its network fee was spent, so the panel must not say nothing was charged (A22)
  if (e instanceof RevertedOnChain) return "revertedOnChain";
  const refused = revertName(e, petRegistryAbi);
  return (refused && REGISTRY_REFUSALS[refused]) || firstLine(e);
}

/** The Breeder's refusals the Family screen explains, by the contract's own error name (A19). */
export const BREED_REFUSALS: Record<string, string> = {
  NotAdult: "notAdultOnChain",
  TooSoon: "tooSoon",
  NoConsent: "noConsent",
  TooManyChildren: "tooManyChildren",
  FeeMoved: "feeMoved",
  NotYours: "notYours",
};
