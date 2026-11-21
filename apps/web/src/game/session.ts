/**
 * Saving without wallet pop-ups. This device keeps a small key of its own; the
 * owner lets it sit the pet on chain (PetRegistry's sitter slot, at most 30
 * days) and gives it a little OKB for gas. A sitter can write the daily
 * checkpoint and nothing else: it cannot move, rename, re-brain or sell the pet.
 *
 * The key lives only in this browser. If it were ever stolen, the most it could
 * do is write checkpoints until the sitting ends, and spend the gas it holds.
 */

import { createWalletClient, http, parseEther, type Hex, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { saveWrite } from "./saveRuntime";

const KEY = "lingxi.session.v1";

/** What the owner sends the session key: about 160 daily saves at today's X Layer gas price. */
export const AUTO_FUND = parseEther("0.0002");
/** Below this the key asks for a top-up rather than risk a failed save. */
export const AUTO_LOW = parseEther("0.00002");
/** How long a sitting lasts when the owner turns auto-save on (the contract's limit is 30 days). */
export const AUTO_DAYS = 30;

let account: PrivateKeyAccount | null = null;

export function sessionAccount(): PrivateKeyAccount {
  if (account) return account;
  let k: Hex | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && /^0x[0-9a-f]{64}$/i.test(raw)) k = raw as Hex;
  } catch {
    // storage blocked: a key for this visit only
  }
  if (!k) {
    k = generatePrivateKey();
    try {
      saveWrite(KEY, k);
    } catch {
      // kept in memory for this visit
    }
  }
  account = privateKeyToAccount(k);
  return account;
}

/**
 * This device's key, written out for the player to keep (H4): a pet kept for free is owned by this key, so whoever holds
 * these 64 characters holds the pet. Shown only when the player asks, with that said beside it.
 */
export function exportSessionKey(): Hex {
  sessionAccount();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (!raw || !/^0x[0-9a-f]{64}$/i.test(raw)) throw new Error("this device's key could not be read");
  return raw as Hex;
}

export function sessionWallet(chain: Parameters<typeof createWalletClient>[0]["chain"], rpc: string): WalletClient {
  return createWalletClient({ chain, transport: http(rpc), account: sessionAccount() });
}
