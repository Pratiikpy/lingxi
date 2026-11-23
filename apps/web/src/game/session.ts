/**
 * Saving without wallet pop-ups. This device keeps a small key of its own; the
 * owner lets it sit the pet on chain (PetRegistry's sitter slot, at most 30
 * days) and gives it a little OKB for gas. A sitter can write the daily
 * checkpoint and nothing else: it cannot move, rename, re-brain or sell the pet.
 *
 * The key lives only in this browser. If it were ever stolen, the most it could
 * do is write checkpoints until the sitting ends, and spend the gas it holds.
 */

import { type Chain, type Hex, type WalletClient, parseEther } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { saveWrite } from "./saveRuntime";
import { viem } from "./chainClient";

const KEY = "lingxi.session.v1";

/** What the owner sends the session key: about 160 daily saves at today's X Layer gas price. */
export const AUTO_FUND = parseEther("0.0002");
/** Below this the key asks for a top-up rather than risk a failed save. */
export const AUTO_LOW = parseEther("0.00002");
/** How long a sitting lasts when the owner turns auto-save on (the contract's limit is 30 days). */
export const AUTO_DAYS = 30;

/** secp256k1's group order: a private key is a number from 1 to n - 1. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** A fresh private key from the browser's own random source, redrawn in the (about 1 in 2^128) case it is out of range. */
function newKey(): Hex {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const hex = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
    const n = BigInt(hex);
    if (n > 0n && n < N) return hex;
  }
}

let key: Hex | null = null;

/**
 * This device's key, made the first time it is needed and kept in this browser. It needs no curve maths: the account
 * that signs with it (sessionAccount) is built from it when a signature or an address is first needed (P3).
 */
function deviceKey(): Hex {
  if (key) return key;
  let k: Hex | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && /^0x[0-9a-f]{64}$/i.test(raw)) k = raw as Hex;
  } catch {
    // storage blocked: a key for this visit only
  }
  if (!k) {
    k = newKey();
    try {
      saveWrite(KEY, k);
    } catch {
      // kept in memory for this visit
    }
  }
  key = k;
  return k;
}

let account: Promise<PrivateKeyAccount> | null = null;

/** The device key as an account that signs, built once. */
export function sessionAccount(): Promise<PrivateKeyAccount> {
  return (account ??= viem().then(({ privateKeyToAccount }) => privateKeyToAccount(deviceKey())));
}

/**
 * This device's key, written out for the player to keep (H4): a pet kept for free is owned by this key, so whoever holds
 * these 64 characters holds the pet. Shown only when the player asks, with that said beside it.
 */
export function exportSessionKey(): Hex {
  deviceKey();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (!raw || !/^0x[0-9a-f]{64}$/i.test(raw)) throw new Error("this device's key could not be read");
  return raw as Hex;
}

export async function sessionWallet(chain: Chain, rpc: string): Promise<WalletClient> {
  const [{ createWalletClient, http }, account] = await Promise.all([viem(), sessionAccount()]);
  return createWalletClient({ chain, transport: http(rpc), account });
}
