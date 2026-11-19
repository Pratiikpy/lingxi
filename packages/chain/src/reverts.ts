/**
 * A19: the contract's own reason for refusing a call, wherever it sits in the error. viem puts a decoded custom error
 * on a later line of its message ('The contract function "breed" reverted.' comes first), so reading the first line
 * loses it; a wallet that does not decode errors may pass back only the error's 4-byte selector. This reads the name
 * from viem's decoded error first, then from anywhere in the text: the whole message, the causes, and any revert data.
 */

import { type Abi, BaseError, ContractFunctionRevertedError, toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";

/** An error an ABI declares. */
type AbiError = Extract<Abi[number], { type: "error" }>;

/** Every text an error carries: its message, its causes' messages, and any revert data a wallet attached. */
function textsOf(e: unknown): string[] {
  const out: string[] = [];
  let x: unknown = e;
  for (let depth = 0; x && depth < 8; depth++) {
    if (typeof x === "string") return [...out, x];
    const o = x as { message?: unknown; shortMessage?: unknown; details?: unknown; data?: unknown; cause?: unknown };
    for (const v of [o.message, o.shortMessage, o.details, o.data]) if (typeof v === "string") out.push(v);
    x = o.cause;
  }
  return out;
}

/** The name of the error `abi` declares that `e` carries, or null when it carries none of them. */
export function revertName(e: unknown, abi: Abi): string | null {
  const errors = abi.filter((x): x is AbiError => x.type === "error");
  const known = new Set(errors.map((x) => x.name));
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    if (name && known.has(name)) return name;
  }
  const text = textsOf(e).join("\n");
  for (const err of errors) {
    if (new RegExp(`\\b${err.name}\\b`).test(text)) return err.name;
    // the selector of the error's signature ("FeeMoved(uint256)"): viem hashes an error object as something else
    if (text.toLowerCase().includes(toFunctionSelector(formatAbiItem(err)))) return err.name;
  }
  return null;
}
