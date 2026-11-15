/**
 * Families on chain. The partner's owner first allows the proposer to breed with
 * their pet; the proposer then hatches the child with a circuit that REFs both
 * parents' current brains (taped out by the relayer), and the Breeder checks
 * that circuit, both parents' age and rest, and mixes their memories.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, parseEventLogs } from "viem";
import { breederAbi } from "./breederAbi";
import type { Deployment } from "./registry";

export async function allowPartnerOnChain(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, partnerOwner: Address): Promise<Hex> {
  if (!d.breeder) throw new Error("no breeder in this deployment");
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({ address: d.breeder, abi: breederAbi, functionName: "allowPartner", args: [petId, partnerOwner, true], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("allowPartner failed");
  return tx;
}

export async function hasConsent(pub: PublicClient, d: Deployment, petId: bigint, partnerOwner: Address): Promise<boolean> {
  if (!d.breeder) return false;
  return (await pub.readContract({ address: d.breeder, abi: breederAbi, functionName: "consent", args: [petId, partnerOwner] })) as boolean;
}

export async function breedOnChain(
  pub: PublicClient,
  wallet: WalletClient,
  d: Deployment,
  a: bigint,
  b: bigint,
  childProcessor: Address,
  childBrainId: bigint,
  line: number,
): Promise<{ childId: bigint; tx: Hex }> {
  if (!d.breeder) throw new Error("no breeder in this deployment");
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request } = await pub.simulateContract({ address: d.breeder, abi: breederAbi, functionName: "breed", args: [a, b, childProcessor, childBrainId, line], account });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("breed failed");
  const born = parseEventLogs({ abi: breederAbi, logs: r.logs, eventName: "Born" })[0];
  if (!born) throw new Error("no Born event");
  return { childId: born.args.child, tx };
}
