/**
 * A pet kept on X Layer for a player with no wallet (H4). The game's own device key asks the server to hatch a pet
 * to it; the request is signed by that key, so nobody can have a pet hatched to an address they do not hold, and
 * dated, so an old request cannot be sent again later. The server checks exactly this text.
 */

import { type Address, type Hex, isAddress, recoverMessageAddress } from "viem";
import type { LocalAccount } from "viem/accounts";

export const SPONSOR_LINES = ["gentle", "bold", "curious"] as const;
export type SponsorLine = (typeof SPONSOR_LINES)[number];

export interface SponsorRequest {
  /** the device key's address: the pet's owner */
  to: Address;
  line: SponsorLine;
  /** the pet's starting state word, in decimal */
  state: string;
  /** when the request was made (ms since the epoch) */
  at: number;
}

/** The exact text the device key signs. */
export const sponsorMessage = (r: SponsorRequest): string =>
  `Lingxi: keep my pet on X Layer for me\naddress ${r.to.toLowerCase()}\nline ${r.line}\nstate ${r.state}\nat ${r.at}`;

export async function signSponsorRequest(account: LocalAccount, r: Omit<SponsorRequest, "to">): Promise<{ request: SponsorRequest; signature: Hex }> {
  const request = { ...r, to: account.address };
  return { request, signature: await account.signMessage({ message: sponsorMessage(request) }) };
}

/** Who signed a request, or null when the request or its signature is not well formed. */
export async function sponsorSigner(r: SponsorRequest, signature: Hex): Promise<Address | null> {
  if (!isAddress(r.to) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  try {
    return await recoverMessageAddress({ message: sponsorMessage(r), signature });
  } catch {
    return null;
  }
}
