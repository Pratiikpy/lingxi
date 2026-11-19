/**
 * A13: an address that runs code refusing tokens. With EIP-7702 a wallet's own address can carry a contract's code;
 * when that code has no ERC-721 or ERC-1155 receiver, every safe mint or transfer to it reverts (OpenZeppelin 5 names
 * the error). The simulation run before any wallet prompt already reports it; this recognises it, from viem's decoded
 * error or from the raw selector a wallet passes back, so the game can say why instead of "it didn't go through".
 */

import { BaseError, ContractFunctionRevertedError } from "viem";

const REFUSALS = ["ERC721InvalidReceiver", "ERC1155InvalidReceiver"] as const;
/** their selectors, as a wallet that does not decode them shows them */
const SELECTORS = ["0x64a0ae92", "0x57f447ce"] as const;

/** Whether `e` says the receiving address refused the token. */
export function refusesTokens(e: unknown): boolean {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) return (REFUSALS as readonly string[]).includes(revert.data.errorName);
  }
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return [...REFUSALS, ...SELECTORS].some((s) => text.includes(s));
}
