/**
 * Families on chain. The partner's owner first allows the proposer to breed with
 * their pet; the proposer then hatches the child with a circuit that REFs both
 * parents' current brains (taped out by the relayer), and the Breeder checks
 * that circuit, both parents' age and rest, and mixes their memories. The BEM
 * breeder (BreederV2) also takes a fee in BEM, moved straight to the dead
 * address: the wallet approves exactly the fee first when it needs to.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, erc20Abi, parseAbi, parseEventLogs } from "viem";
import { breederAbi } from "./breederAbi";
import { readPet } from "./registry";
import { breederV2Abi } from "./breederV2Abi";

/** The breeder's ABI plus the BEM token's own errors, so a payment refusal is named, not shown as a raw selector. */
const breedWithTokenErrors = [
  ...breederV2Abi,
  ...parseAbi(["error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)", "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)"]),
] as const;
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

/** The breeding fee and how many children each parent may still have; null on the free breeder. */
export async function breedingTerms(pub: PublicClient, d: Deployment, parents: readonly bigint[] = []): Promise<{ fee: bigint; bem: Address; childrenLeft: number[] } | null> {
  if (!d.breeder || !d.breederBem) return null;
  const read = <T>(functionName: string, args: unknown[] = []) => pub.readContract({ address: d.breeder!, abi: breederV2Abi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [fee, bem, max, ...kids] = await Promise.all([read<bigint>("breedFee"), read<Address>("bem"), read<number>("MAX_CHILDREN"), ...parents.map((p) => read<number>("children", [p]))]);
  return { fee, bem, childrenLeft: kids.map((k) => Number(max) - Number(k)) };
}

/** What another player said about their pet, checked against X Layer before anything is signed or taped out for it. */
export type PartnerCheck = "ok" | "notOwner" | "notBrain" | "unreadable";

/**
 * Whether `info` (a pet id, its owner, its brain, as a peer sent them) is true on chain now: the address owns the pet
 * and the pet's brain is that circuit. A peer can send anything, so nothing is signed or spent on its word alone.
 */
export async function checkPartner(pub: PublicClient, d: Deployment, info: { petId: string; owner: string; brain: string }): Promise<PartnerCheck> {
  if (!/^\d{1,20}$/.test(info.petId) || !/^\d{1,20}$/.test(info.brain) || !/^0x[0-9a-fA-F]{40}$/.test(info.owner)) return "notOwner";
  try {
    const pet = await readPet(pub, d, BigInt(info.petId));
    if (pet.owner.toLowerCase() !== info.owner.toLowerCase()) return "notOwner";
    return pet.brainId === BigInt(info.brain) ? "ok" : "notBrain";
  } catch {
    return "unreadable";
  }
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
  let tx: Hex;
  if (d.breederBem) {
    const terms = (await breedingTerms(pub, d))!;
    // the breeder's own rules come first (consent, age, rest, the child circuit, the cap): simulate the breed and
    // surface any refusal that is not about the payment itself, so a missing consent is never shown as missing BEM
    try {
      await pub.simulateContract({ address: d.breeder, abi: breedWithTokenErrors, functionName: "breed", args: [a, b, childProcessor, childBrainId, line, terms.fee], account });
    } catch (e) {
      if (!/ERC20Insufficient|ERC20InvalidSpender|transfer amount exceeds/i.test(String((e as Error).message))) throw e;
    }
    const [balance, allowance] = await Promise.all([
      pub.readContract({ address: terms.bem, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
      pub.readContract({ address: terms.bem, abi: erc20Abi, functionName: "allowance", args: [account.address, d.breeder] }) as Promise<bigint>,
    ]);
    if (balance < terms.fee) throw new Error("not enough BEM");
    if (allowance < terms.fee) {
      const { request: ap } = await pub.simulateContract({ address: terms.bem, abi: erc20Abi, functionName: "approve", args: [d.breeder, terms.fee], account });
      const at = await wallet.writeContract(ap);
      if ((await pub.waitForTransactionReceipt({ hash: at })).status !== "success") throw new Error("approve failed");
    }
    const { request } = await pub.simulateContract({ address: d.breeder, abi: breederV2Abi, functionName: "breed", args: [a, b, childProcessor, childBrainId, line, terms.fee], account });
    tx = await wallet.writeContract(request);
  } else {
    const { request } = await pub.simulateContract({ address: d.breeder, abi: breederAbi, functionName: "breed", args: [a, b, childProcessor, childBrainId, line], account });
    tx = await wallet.writeContract(request);
  }
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error("breed failed");
  const born = parseEventLogs({ abi: breederAbi, logs: r.logs, eventName: "Born" })[0];
  if (!born) throw new Error("no Born event");
  return { childId: born.args.child, tx };
}
