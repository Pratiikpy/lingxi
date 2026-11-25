/**
 * The ways this device reaches X Layer and Lingxi's server (P7: out of chain.ts): the player's wallet, the
 * device's own key for keeping a pet for free (H4) and saving it automatically, who signs a relayed request, the
 * record of a birth, and a newborn's first day saved at once (A33).
 */
import { walletNeeded } from "./move";
import { type Address, type Hex, type WalletClient } from "viem";
import { viem } from "./chainClient";
import {
  type Deployment,
  checkpointOnChain,
  readKeeping,
  readPet,
  signRelay,
  type SignedRelay,
  signSponsorRequest,
} from "@lingxi/chain";
import { AUTO_LOW, sessionAccount, sessionWallet } from "./session";
import { type Pet, packState, stageOf, unpackState } from "@lingxi/game";
import { now as gameNow } from "./gameClock";
import { type ChainRecord, autoStatus, mindKey, chainDay, petKey, records, store } from "./chainRecords";

import { OFFICIAL_RPCS, chain, deployment as networkDeployment, injected, publicClient, rpc } from "./network";
// a module constant of its own, so a check for it narrows it inside the closures below
const deployment: Deployment | undefined = networkDeployment;

export async function connectWallet(): Promise<WalletClient> {
  const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_KEY as Hex | undefined) : undefined;
  const { createWalletClient, custom, http, privateKeyToAccount } = await viem();
  if (devKey) return createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(devKey) });
  const provider = injected();
  if (!provider) {
    // inside Telegram there is never a wallet: offer to carry the pets to the browser
    walletNeeded();
    throw new Error("noWallet");
  }
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!address) throw new Error("noAccount");
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4" }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0xc4",
          chainName: "X Layer",
          nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
          rpcUrls: OFFICIAL_RPCS,
          blockExplorerUrls: ["https://www.oklink.com/xlayer"],
        },
      ],
    });
  }
  return createWalletClient({ chain, transport: custom(provider), account: address });
}

/** Only the deployment's own breeders: an address from the server is never called unless it is one of them. */
export const breedersHere = (): Address[] =>
  [deployment?.breeder, deployment?.breederFree].filter((a): a is Address => !!a);
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");

export type KeptFree =
  | { ok: true; petId: string | null; hatchTx: string | null; grantTx: string | null }
  | { ok: false; reason: string };

/** Asks the server to keep this pet on X Layer for this device's key (H4), signed by that key. */
export async function askToKeep(key: Awaited<ReturnType<typeof sessionAccount>>, pet: Pet): Promise<KeptFree> {
  const { request, signature } = await signSponsorRequest(key, {
    line: pet.line,
    state: packState(pet, stageOf(pet, gameNow())).toString(),
    at: Math.round(gameNow()),
  });
  const res = await fetch(`${API_BASE}/api/sponsor/hatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, signature }),
  });
  const body = (await res.json()) as Partial<KeptFree> & { ok?: boolean; reason?: string };
  return body.ok
    ? { ok: true, petId: body.petId ?? null, hatchTx: body.hatchTx ?? null, grantTx: body.grantTx ?? null }
    : { ok: false, reason: body.reason ?? "error" };
}

/** What the server kept for this key, when its answer to the request was lost. */
export async function keptFor(address: string): Promise<{ petId: string; hatchTx: string } | null> {
  try {
    const r = (await (await fetch(`${API_BASE}/api/sponsor/of/${address}`)).json()) as {
      ok?: boolean;
      petId?: string | null;
      hatchTx?: string | null;
    };
    return r.ok && r.petId && r.hatchTx ? { petId: r.petId, hatchTx: r.hatchTx } : null;
  } catch {
    return null;
  }
}
/** How far behind X Layer's head the server's index may be and still be called complete (about ten minutes of blocks). */
export const INDEX_BEHIND_OK = 600;

/** A child's record, from the birth that made it. */
export async function birthRecord(
  childId: bigint,
  tx: Hex,
  owner: string,
  brainId: string,
): Promise<{ record: ChainRecord; memory: number[] }> {
  const onChain = await readPet(publicClient, deployment!, childId);
  const record: ChainRecord = {
    petId: childId.toString(),
    hatchTx: tx,
    lastDay: 0,
    owner,
    bornChain: onChain.born,
    brains: { [mindKey([])]: brainId },
    brainKey: mindKey([]),
  };
  return { record, memory: unpackState(onChain.state, onChain.brainBits).brain };
}

/**
 * The auto-save key's wallet when it may save this pet right now (sitting on
 * chain, not expired, enough gas), else null. A sitting replaced on chain (a
 * friend now sits the pet) turns auto-save off on this device.
 */
/**
 * Who signs a request for the relayer to tape out this pet's brain: this device's own key when it keeps the pet on
 * chain (no prompt at all), otherwise the owner's wallet, once, with no fee and no transaction.
 */
export async function relaySigner(
  petId: string,
  wallet?: WalletClient,
): Promise<{ address: Address; signMessage: (m: { message: string }) => Promise<Hex> }> {
  const key = await sessionAccount();
  // a keeping that cannot be read falls back to the owner's wallet signing, which always works
  if (deployment && (await readKeeping(publicClient, deployment, BigInt(petId), key.address).catch(() => null))?.keeper)
    return key;
  const w = wallet ?? (await connectWallet());
  const account = w.account;
  if (!account) throw new Error("wallet has no account");
  return { address: account.address, signMessage: ({ message }) => w.signMessage({ account, message }) };
}

/**
 * A season entry signed as this pet on X Layer (kind "season"), so the server can prove it and put it in line for the
 * keepsake. Null for a pet that is not on chain. Throws when no keeper can sign (no wallet, or the signature declined).
 */
export async function signSeasonEntry(pet: Pet, entry: unknown): Promise<SignedRelay<"season"> | null> {
  const record = records[petKey(pet)];
  if (!deployment || !record) return null;
  return signRelay(await relaySigner(record.petId), "season", record.petId, entry);
}

/** `refresh` puts the active record back on screen when a replaced sitting turns auto-save off. */
export async function autoWallet(pet: Pet, record: ChainRecord, refresh: () => void): Promise<WalletClient | null> {
  if (!deployment || autoStatus(record, gameNow()) === "off") return null;
  // kept for free: this device's key owns the pet and saves it as its owner, while it has gas
  if (record.device) {
    const key = (await sessionAccount()).address;
    if (record.owner.toLowerCase() !== key.toLowerCase()) return null;
    return (await publicClient.getBalance({ address: key })) < AUTO_LOW ? null : sessionWallet(chain, rpc);
  }
  const key = (await sessionAccount()).address;
  const [k, balance] = await Promise.all([
    readKeeping(publicClient, deployment, BigInt(record.petId), key),
    publicClient.getBalance({ address: key }),
  ]);
  if (!k.keeper) {
    store(pet, { ...record, autoUntil: undefined });
    refresh();
    return null;
  }
  if (balance < AUTO_LOW) return null;
  return sessionWallet(chain, rpc);
}

/** Whether the auto-save key is running low on gas. */
export async function autoGasLow(): Promise<boolean> {
  return (await publicClient.getBalance({ address: (await sessionAccount()).address })) < AUTO_LOW;
}

/**
 * A33: the Breeder records only a newborn's mixed memory, so until a day is saved X Layer reads it as an egg with every
 * meter at 0 (PetLook's picture, its metadata, its proof page). Its first day is saved at once, from the wallet that
 * owns it, with the memory the chain mixed and the newborn's own stage and meters. Returns whether it was saved; when it
 * was not (refused in the wallet, refused on chain, the network), the birth stands and the Save button saves day 1.
 */
export async function saveFirstDay(wallet: WalletClient, record: ChainRecord, pet: Pet): Promise<boolean> {
  if (!deployment) return false;
  try {
    // counted the way PetRegistry counts days: from block time
    const day = chainDay(record, Number((await publicClient.getBlock()).timestamp) * 1000);
    const tx = await checkpointOnChain(
      publicClient,
      wallet,
      deployment,
      BigInt(record.petId),
      day,
      packState(pet, stageOf(pet, gameNow())),
      pet.logHash as Hex,
    );
    store(pet, { ...record, lastDay: day, lastTx: tx, logLen: pet.pendingLog.length });
    return true;
  } catch {
    return false;
  }
}
