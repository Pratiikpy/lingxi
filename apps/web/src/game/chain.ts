/**
 * Keeping a pet on X Layer from the browser: connect a wallet, hatch the pet's
 * on-chain twin with its starter brain, and write daily checkpoints.
 *
 * Wallets: an injected wallet (OKX Wallet first, then any EIP-1193 provider).
 * In local development against a fork only, a throwaway test key can stand in
 * (VITE_DEV_KEY); it is never part of a production build.
 */

import { create } from "zustand";
import { createPublicClient, createWalletClient, custom, http, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Deployment, checkpointOnChain, hatchOnChain, readPet, xLayer } from "@lingxi/chain";
import { type Pet, packState, stageOf } from "@lingxi/game";
import localDeployment from "../../../../packages/chain/deployments/local.json";

const CHAIN_KEY = "lingxi.chain.v1";
const LINES = ["gentle", "bold", "curious"] as const;

const NETWORK = (import.meta.env.VITE_CHAIN as string | undefined) ?? (import.meta.env.DEV ? "local" : "xlayer");
const DEPLOYMENTS: Record<string, Deployment | undefined> = { local: localDeployment as unknown as Deployment };
export const deployment: Deployment | undefined = DEPLOYMENTS[NETWORK];
export const explorerTx = (tx: string) => (NETWORK === "local" ? null : `https://www.oklink.com/xlayer/tx/${tx}`);

const rpc = deployment?.rpc ?? "https://rpc.xlayer.tech";
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
export const publicClient: PublicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Eip1193 | null {
  const w = window as unknown as { okxwallet?: Eip1193; ethereum?: Eip1193 };
  return w.okxwallet ?? w.ethereum ?? null;
}

async function connectWallet(): Promise<WalletClient> {
  const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_KEY as Hex | undefined) : undefined;
  if (devKey) return createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(devKey) });
  const provider = injected();
  if (!provider) throw new Error("noWallet");
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!address) throw new Error("noAccount");
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4" }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0xc4", chainName: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: ["https://rpc.xlayer.tech"], blockExplorerUrls: ["https://www.oklink.com/xlayer"] }],
    });
  }
  return createWalletClient({ chain, transport: custom(provider), account: address });
}

export interface ChainRecord {
  petId: string;
  hatchTx: string;
  lastDay: number;
  lastTx?: string;
  owner: string;
  /** block timestamp (seconds) of the on-chain hatch; checkpoint days count from it */
  bornChain: number;
}

/** The on-chain day number now, as PetRegistry counts it. */
export const chainDay = (r: ChainRecord, nowMs: number) => Math.floor((nowMs / 1000 - r.bornChain) / 86_400) + 1;

function loadRecord(): ChainRecord | null {
  try {
    const r = localStorage.getItem(CHAIN_KEY);
    return r ? (JSON.parse(r) as ChainRecord) : null;
  } catch {
    return null;
  }
}

interface ChainState {
  record: ChainRecord | null;
  busy: "idle" | "connecting" | "hatching" | "saving";
  error: string | null;
  keep: (pet: Pet) => Promise<void>;
  saveToday: (pet: Pet, onSaved: () => void) => Promise<void>;
  forget: () => void;
}

export const useChain = create<ChainState>((set, get) => ({
  record: loadRecord(),
  busy: "idle",
  error: null,
  keep: async (pet) => {
    if (!deployment) return set({ error: "notDeployed" });
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "hatching" });
      const line = LINES.indexOf(pet.line);
      const { petId, tx } = await hatchOnChain(publicClient, wallet, deployment, line, pet.line, packState(pet, stageOf(pet, Date.now())));
      const onChain = await readPet(publicClient, deployment, petId);
      const record: ChainRecord = { petId: petId.toString(), hatchTx: tx, lastDay: 0, owner: wallet.account!.address, bornChain: onChain.born };
      localStorage.setItem(CHAIN_KEY, JSON.stringify(record));
      set({ record, busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: (e as Error).message.split("\n")[0] ?? "failed" });
    }
  },
  saveToday: async (pet, onSaved) => {
    const { record } = get();
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      const day = chainDay(record, Date.now());
      if (day <= record.lastDay) {
        set({ busy: "idle", error: "alreadySaved" });
        return;
      }
      const tx = await checkpointOnChain(publicClient, wallet, deployment, BigInt(record.petId), day, packState(pet, stageOf(pet, Date.now())), pet.logHash as Hex);
      const next = { ...record, lastDay: day, lastTx: tx };
      localStorage.setItem(CHAIN_KEY, JSON.stringify(next));
      set({ record: next, busy: "idle" });
      onSaved();
    } catch (e) {
      set({ busy: "idle", error: (e as Error).message.split("\n")[0] ?? "failed" });
    }
  },
  forget: () => {
    localStorage.removeItem(CHAIN_KEY);
    set({ record: null });
  },
}));
