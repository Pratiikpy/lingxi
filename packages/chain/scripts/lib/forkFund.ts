/**
 * Funding a test address on a local fork of X Layer, with no real money: native OKB through `anvil_setBalance`, and
 * an ERC-20 by finding the slot of its balances mapping and writing the amount there. Local nodes only.
 */

import { encodeAbiParameters, keccak256, numberToHex, pad, type Address, type Hex, type PublicClient } from "viem";

const balanceOfAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

/** Refuses anything but a node on this machine: these calls rewrite chain state. */
export function assertLocal(rpc: string): void {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(rpc)) throw new Error(`fork funding only runs against a local node, not ${rpc}`);
}

/** Sets an address's native balance (OKB), in wei. */
export async function giveOkb(pub: PublicClient, to: Address, wei: bigint): Promise<void> {
  await pub.request({ method: "anvil_setBalance" as never, params: [to, numberToHex(wei)] as never });
}

/**
 * Sets an address's balance of an ERC-20 by writing its balances mapping: tries each of the first 60 storage slots as
 * the mapping, keeps the one `balanceOf` then reports, and puts every other slot back. Returns the slot.
 */
export async function giveToken(pub: PublicClient, token: Address, to: Address, amount: bigint): Promise<bigint> {
  for (let slot = 0n; slot < 60n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, slot]));
    const before = await pub.getStorageAt({ address: token, slot: key });
    await pub.request({ method: "anvil_setStorageAt" as never, params: [token, key, pad(numberToHex(amount), { size: 32 })] as never });
    const bal = await pub.readContract({ address: token, abi: balanceOfAbi, functionName: "balanceOf", args: [to] });
    if (bal === amount) return slot;
    await pub.request({ method: "anvil_setStorageAt" as never, params: [token, key, (before ?? pad("0x0", { size: 32 })) as Hex] as never });
  }
  throw new Error(`could not find the balances slot of ${token}`);
}
