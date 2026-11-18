/**
 * Asking Lingxi's relayer to tape out a brain is signed by a key that may keep the pet on chain (its owner, an approved
 * address, or its sitter, such as this device's own key: `PetRegistry.isKeeper`). The signature covers the exact
 * request, a one-time nonce and the time, so it cannot be replayed, reused for another pet, or attached to a different
 * request. Signing is free and sends no transaction; the message says so in both languages.
 */

import { type Address, type Hex, sha256, stringToBytes } from "viem";

export type RelayKind = "brain" | "child" | "instinct";

export interface RelayAuth {
  signer: Address;
  nonce: string;
  /** unix seconds */
  time: number;
  signature: Hex;
}

/** What is sent: the request as the exact text that was signed, and who signed it. */
export interface SignedRelay {
  kind: RelayKind;
  petId: string;
  payload: string;
  auth: RelayAuth;
}

const WHAT: Record<RelayKind, { en: string; zh: string }> = {
  brain: { en: "tape out a new brain", zh: "流片新大脑" },
  child: { en: "tape out a little one's brain", zh: "流片小宝宝的大脑" },
  instinct: { en: "tape out an instinct", zh: "流片一个本能" },
};

export const relayPayloadHash = (payload: string): Hex => sha256(stringToBytes(payload));

/** The text a keeper signs (EIP-191). Both sides build it the same way from the same fields. */
export function relayMessage(o: { kind: RelayKind; petId: string; payload: string; nonce: string; time: number }): string {
  const w = WHAT[o.kind];
  return [
    `Lingxi: ${w.en} for pet #${o.petId}. No fee, no transaction.`,
    `灵犀：为 ${o.petId} 号宠物${w.zh}。不收费，不发交易。`,
    "",
    `kind: ${o.kind}`,
    `pet: ${o.petId}`,
    `request: ${relayPayloadHash(o.payload)}`,
    `nonce: ${o.nonce}`,
    `time: ${o.time}`,
    "chain: 196",
  ].join("\n");
}

/** Signs a relay request with any signer that can sign a personal message (a wallet or this device's key). */
export async function signRelay(
  signer: { address: Address; signMessage: (m: { message: string }) => Promise<Hex> },
  kind: RelayKind,
  petId: string,
  body: unknown,
  now = Date.now(),
): Promise<SignedRelay> {
  const payload = JSON.stringify(body);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const time = Math.floor(now / 1000);
  const signature = await signer.signMessage({ message: relayMessage({ kind, petId, payload, nonce, time }) });
  return { kind, petId, payload, auth: { signer: signer.address, nonce, time, signature } };
}
