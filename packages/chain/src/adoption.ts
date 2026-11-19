/**
 * The adoption centre (plan 4.8): offers of young bred pets, read from the centre and the registry, and the steps
 * to offer, withdraw and adopt. BEM moves straight from the buyer's wallet; the centre never holds any.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, erc20Abi } from "viem";
import { adoptionCentreAbi } from "./adoptionCentreAbi";
import { readOutsideCircuit } from "./adopt";
import { petRegistryAbi } from "./registryAbi";
import { type ChainPet, type Deployment, readPet } from "./registry";
import { RevertedOnChain } from "./receipts";

export interface Offer {
  petId: bigint;
  seller: Address;
  price: bigint;
  expiresAt: number;
  live: boolean;
  pet: ChainPet;
  /** who gets the 10% share (the owner of the parent the breeder does not own), if anyone */
  coParent: Address | null;
}

export interface AdoptionTerms {
  feeBps: number;
  coParentBps: number;
  youngAge: number;
  minPrice: bigint;
  maxPrice: bigint;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const acct = (w: WalletClient) => {
  if (!w.account) throw new Error("no account");
  return w.account;
};
const centreOf = (d: Deployment): Address => {
  if (!d.adoptionCentre) throw new Error("noCentre");
  return d.adoptionCentre;
};

export async function adoptionTerms(pub: PublicClient, d: Deployment): Promise<AdoptionTerms> {
  const c = centreOf(d);
  const read = (functionName: "feeBps" | "COPARENT_BPS" | "YOUNG_AGE" | "MIN_PRICE" | "MAX_PRICE") => pub.readContract({ address: c, abi: adoptionCentreAbi, functionName });
  const [fee, co, young, min, max] = await Promise.all([read("feeBps"), read("COPARENT_BPS"), read("YOUNG_AGE"), read("MIN_PRICE"), read("MAX_PRICE")]);
  return { feeBps: Number(fee), coParentBps: Number(co), youngAge: Number(young), minPrice: BigInt(min as bigint), maxPrice: BigInt(max as bigint) };
}

/** Every offer the centre holds, newest pets first, with whether it can be adopted now. */
export async function readOffers(pub: PublicClient, d: Deployment): Promise<Offer[]> {
  const c = centreOf(d);
  const ids = (await pub.readContract({ address: c, abi: adoptionCentreAbi, functionName: "open" })) as readonly bigint[];
  const offers = await Promise.all(
    ids.map(async (petId) => {
      const [row, live, pet] = await Promise.all([
        pub.readContract({ address: c, abi: adoptionCentreAbi, functionName: "listings", args: [petId] }) as Promise<readonly [Address, bigint, bigint, Hex]>,
        pub.readContract({ address: c, abi: adoptionCentreAbi, functionName: "isLive", args: [petId] }) as Promise<boolean>,
        readPet(pub, d, petId),
      ]);
      const [seller, price, expiresAt] = row;
      const co = (await pub.readContract({ address: c, abi: adoptionCentreAbi, functionName: "coParentOf", args: [petId, seller] })) as Address;
      return { petId, seller, price: BigInt(price), expiresAt: Number(expiresAt), live, pet, coParent: co === ZERO ? null : co };
    }),
  );
  return offers.filter((o) => o.seller !== ZERO).sort((a, b) => Number(b.petId - a.petId));
}

/** Can this pet be offered now: bred, never moved, young, and the wallet's. Returns the reason it cannot. */
export async function offerable(pub: PublicClient, d: Deployment, petId: bigint, who: Address, nowSec: number): Promise<"ok" | "notYours" | "notBred" | "moved" | "grown"> {
  const [pet, moved, terms] = await Promise.all([
    readPet(pub, d, petId),
    pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "transferCount", args: [petId] }) as Promise<bigint>,
    adoptionTerms(pub, d),
  ]);
  if (pet.owner.toLowerCase() !== who.toLowerCase()) return "notYours";
  if (pet.parentA === 0n) return "notBred";
  if (moved !== 0n) return "moved";
  if (nowSec >= pet.born + terms.youngAge) return "grown";
  return "ok";
}

/** Offer a little one: allow the centre to move this one pet, then list it. */
export async function offerChild(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, price: bigint, expiresAt: number): Promise<Hex> {
  const c = centreOf(d);
  const approved = (await pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "getApproved", args: [petId] })) as Address;
  if (approved.toLowerCase() !== c.toLowerCase()) {
    const { request } = await pub.simulateContract({ address: d.registry, abi: petRegistryAbi, functionName: "approve", args: [c, petId], account: acct(wallet) });
    const a = await wallet.writeContract(request);
    if ((await pub.waitForTransactionReceipt({ hash: a })).status !== "success") throw new RevertedOnChain("approve", a);
  }
  const { request } = await pub.simulateContract({ address: c, abi: adoptionCentreAbi, functionName: "list", args: [petId, price, BigInt(expiresAt)], account: acct(wallet) });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("list", tx);
  return tx;
}

export async function withdrawOffer(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint): Promise<Hex> {
  const { request } = await pub.simulateContract({ address: centreOf(d), abi: adoptionCentreAbi, functionName: "withdraw", args: [petId], account: acct(wallet) });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("withdraw", tx);
  return tx;
}

/** Adopt at the price the buyer saw: approve exactly that much BEM if needed, then adopt. */
export async function adoptChild(pub: PublicClient, wallet: WalletClient, d: Deployment, petId: bigint, price: bigint): Promise<Hex> {
  const c = centreOf(d);
  const who = acct(wallet).address;
  const bem = (await pub.readContract({ address: c, abi: adoptionCentreAbi, functionName: "bem" })) as Address;
  const [balance, allowance] = await Promise.all([
    pub.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>,
    pub.readContract({ address: bem, abi: erc20Abi, functionName: "allowance", args: [who, c] }) as Promise<bigint>,
  ]);
  if (balance < price) throw new Error("notEnoughBem");
  if (allowance < price) {
    const { request } = await pub.simulateContract({ address: bem, abi: erc20Abi, functionName: "approve", args: [c, price], account: acct(wallet) });
    const a = await wallet.writeContract(request);
    if ((await pub.waitForTransactionReceipt({ hash: a })).status !== "success") throw new RevertedOnChain("approve", a);
  }
  const { request } = await pub.simulateContract({ address: c, abi: adoptionCentreAbi, functionName: "adopt", args: [petId, price], account: acct(wallet) });
  const tx = await wallet.writeContract(request);
  if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new RevertedOnChain("adopt", tx);
  return tx;
}

/** Everything the paper check needs from the chain: the pet's record and its brain circuit with the two it REFs. */
export async function childView(pub: PublicClient, d: Deployment, petId: bigint) {
  const pet = await readPet(pub, d, petId);
  const brain = await readOutsideCircuit(pub, pet.processor, pet.brainId);
  return {
    pet,
    view: {
      line: pet.line,
      parentA: pet.parentA,
      parentB: pet.parentB,
      day: pet.day,
      state: pet.state,
      logHash: pet.logHash,
      brainBits: pet.brainBits,
      parts: brain.parts.map((p) => ({ processor: p.processor, id: p.id, hex: p.hex })),
    },
  };
}

/** The centre's own BEM burned total. */
export const centreBurned = (pub: PublicClient, d: Deployment): Promise<bigint> =>
  pub.readContract({ address: centreOf(d), abi: adoptionCentreAbi, functionName: "totalBurned" }) as Promise<bigint>;
