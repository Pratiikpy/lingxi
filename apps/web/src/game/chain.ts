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
import { type Deployment, allowPartnerOnChain, breedOnChain, checkpointOnChain, hatchOnChain, readPet, setBrainOnChain, xLayer } from "@lingxi/chain";
import { type Pet, logSegments, packState, petCard, stageOf, unpackState } from "@lingxi/game";
import { relayBrain, relayChild } from "./api";
import type { ChainInfo } from "./live";
import { useGame } from "./store";
import localDeployment from "../../../../packages/chain/deployments/local.json";
import xlayerDeployment from "../../../../packages/chain/deployments/xlayer.json";

const OLD_KEY = "lingxi.chain.v1";
const CHAIN_KEY = "lingxi.chain.v2";
const LINES = ["gentle", "bold", "curious"] as const;

const NETWORK = (import.meta.env.VITE_CHAIN as string | undefined) ?? (import.meta.env.DEV ? "local" : "xlayer");
const DEPLOYMENTS: Record<string, Deployment | undefined> = { local: localDeployment as unknown as Deployment, xlayer: xlayerDeployment as unknown as Deployment };
export const deployment: Deployment | undefined = DEPLOYMENTS[NETWORK];
export const explorerTx = (tx: string) => (NETWORK === "local" ? null : `https://www.oklink.com/xlayer/tx/${tx}`);

const rpc = deployment?.rpc ?? "https://rpc.xlayer.tech";
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
export const publicClient: PublicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
/** X Layer's official RPC endpoints, for spreading heavy read loads (the proof page's full check). */
export const readClients: PublicClient[] =
  NETWORK === "xlayer"
    ? ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"].map((u) => createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [u] } } }, transport: http(u) }) as PublicClient)
    : [publicClient];

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Eip1193 | null {
  const w = window as unknown as { okxwallet?: Eip1193; ethereum?: Eip1193 };
  return w.okxwallet ?? w.ethereum ?? null;
}

export async function connectWallet(): Promise<WalletClient> {
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
  /** lessons key → circuit id of every brain this pet has run on chain */
  brains?: Record<string, string>;
  /** lessons key of the brain the pet runs on chain now */
  brainKey?: string;
  /** how many logged words the last checkpoint covers */
  logLen?: number;
}

/** The first line of an error, for showing to the player. */
const firstLine = (e: unknown): string => (e as Error).message?.split(/\r?\n/)[0] || "failed";

export const lessonsKey =(lessons: unknown[]) => JSON.stringify(lessons);

/** The on-chain day number now, as PetRegistry counts it. */
export const chainDay = (r: ChainRecord, nowMs: number) => Math.floor((nowMs / 1000 - r.bornChain) / 86_400) + 1;

/** Each pet on this device is known by its birth time; chain records are kept per pet. */
export const petKey = (p: Pick<Pet, "bornAt">) => String(p.bornAt);

function loadRecords(): Record<string, ChainRecord> {
  try {
    const r = localStorage.getItem(CHAIN_KEY);
    if (r) return JSON.parse(r) as Record<string, ChainRecord>;
    // from before families: the one record belonged to the first pet
    const old = localStorage.getItem(OLD_KEY);
    const first = useGame.getState().pets[0];
    if (old && first) return { [petKey(first)]: JSON.parse(old) as ChainRecord };
  } catch {
    // unreadable: no records rather than a crash
  }
  return {};
}

let records = loadRecords();
function store(pet: Pet, rec: ChainRecord | null): void {
  const next = { ...records };
  if (rec) next[petKey(pet)] = rec;
  else delete next[petKey(pet)];
  records = next;
  try {
    localStorage.setItem(CHAIN_KEY, JSON.stringify(records));
  } catch {
    // in memory for this visit
  }
}
const activeRecord = () => {
  const p = useGame.getState().pet;
  return p ? (records[petKey(p)] ?? null) : null;
};

interface ChainState {
  record: ChainRecord | null;
  busy: "idle" | "connecting" | "hatching" | "saving" | "taping";
  error: string | null;
  keep: (pet: Pet) => Promise<void>;
  saveToday: (pet: Pet, onSaved: () => void) => Promise<void>;
  updateMind: (pet: Pet) => Promise<void>;
  exportLog: (pet: Pet) => string | null;
  forget: () => void;
  /** the record of any pet on this device */
  recordOf: (pet: Pet) => ChainRecord | null;
  /** this pet's on-chain identity for a family request, if it lives on chain */
  infoOf: (pet: Pet) => ChainInfo | null;
  /** the partner's owner allows the proposer's owner to raise a child with this pet */
  allow: (pet: Pet, partnerOwner: string) => Promise<boolean>;
  /** hatch the newborn through the Breeder; returns the child's memory as the chain mixed it */
  breed: (parent: Pet, partner: ChainInfo, child: Pet) => Promise<{ ok: true; memory: number[] } | { ok: false; reason: string }>;
}

export const useChain = create<ChainState>((set, get) => ({
  record: activeRecord(),
  recordOf: (pet) => records[petKey(pet)] ?? null,
  infoOf: (pet) => {
    const r = records[petKey(pet)];
    const brain = r?.brains?.[r.brainKey ?? ""];
    return r && brain && deployment?.breeder ? { petId: r.petId, owner: r.owner, brain } : null;
  },
  allow: async (pet, partnerOwner) => {
    const r = records[petKey(pet)];
    if (!deployment?.breeder || !r) return false;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      await allowPartnerOnChain(publicClient, wallet, deployment, BigInt(r.petId), partnerOwner as Hex);
      set({ busy: "idle" });
      return true;
    } catch (e) {
      set({ busy: "idle", error: firstLine(e) });
      return false;
    }
  },
  breed: async (parent, partner, child) => {
    const r = records[petKey(parent)];
    const mine = r?.brains?.[r.brainKey ?? ""];
    if (!deployment?.breeder || !r || !mine) return { ok: false, reason: "offChain" };
    set({ busy: "taping", error: null });
    try {
      const relayed = await relayChild({ parents: [mine, partner.brain] });
      if (!relayed.ok) throw new Error(relayed.reason);
      const wallet = await connectWallet();
      set({ busy: "hatching" });
      const { childId, tx } = await breedOnChain(publicClient, wallet, deployment, BigInt(r.petId), BigInt(partner.petId), deployment.processor, BigInt(relayed.brainId), LINES.indexOf(child.line));
      const onChain = await readPet(publicClient, deployment, childId);
      store(child, {
        petId: childId.toString(),
        hatchTx: tx,
        lastDay: 0,
        owner: wallet.account!.address,
        bornChain: onChain.born,
        brains: { [lessonsKey([])]: relayed.brainId },
        brainKey: lessonsKey([]),
      });
      set({ busy: "idle", record: activeRecord() });
      return { ok: true, memory: unpackState(onChain.state, onChain.brainBits).brain };
    } catch (e) {
      const msg = firstLine(e);
      set({ busy: "idle", error: msg });
      return { ok: false, reason: /NotAdult/.test(msg) ? "notAdultOnChain" : /TooSoon/.test(msg) ? "tooSoon" : /NoConsent/.test(msg) ? "noConsent" : msg };
    }
  },
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
      const record: ChainRecord = {
        petId: petId.toString(),
        hatchTx: tx,
        lastDay: 0,
        owner: wallet.account!.address,
        bornChain: onChain.born,
        brains: { [lessonsKey([])]: deployment.circuits[pet.line]!.id },
        brainKey: lessonsKey([]),
      };
      store(pet, record);
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: (e as Error).message.split("\n")[0] ?? "failed" });
    }
  },
  saveToday: async (pet, onSaved) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      // days are counted the way PetRegistry counts them: from block time, not this computer's clock
      const blockMs = Number((await publicClient.getBlock()).timestamp) * 1000;
      const day = chainDay(record, blockMs);
      if (day <= record.lastDay) {
        set({ busy: "idle", error: "alreadySaved" });
        return;
      }
      const tx = await checkpointOnChain(publicClient, wallet, deployment, BigInt(record.petId), day, packState(pet, stageOf(pet, Date.now())), pet.logHash as Hex);
      const next = { ...record, lastDay: day, lastTx: tx, logLen: pet.pendingLog.length };
      store(pet, next);
      set({ record: activeRecord(), busy: "idle" });
      onSaved();
    } catch (e) {
      set({ busy: "idle", error: (e as Error).message.split("\n")[0] ?? "failed" });
    }
  },
  updateMind: async (pet) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const key = lessonsKey(pet.lessons);
      let brainId = record.brains?.[key];
      if (!brainId) {
        set({ busy: "taping" });
        // a child's mind is both halves, REF'd by a new child circuit
        const r = pet.family ? await relayChild({ card: petCard(pet) }) : await relayBrain({ line: pet.line, lessons: pet.lessons });
        if (!r.ok) throw new Error(r.reason);
        brainId = r.brainId;
      }
      const wallet = await connectWallet();
      set({ busy: "saving" });
      await setBrainOnChain(publicClient, wallet, deployment, BigInt(record.petId), deployment.processor, BigInt(brainId));
      const next = { ...record, brains: { ...(record.brains ?? {}), [key]: brainId }, brainKey: key };
      store(pet, next);
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: (e as Error).message.split("\n")[0] ?? "failed" });
    }
  },
  exportLog: (pet) => {
    const record = records[petKey(pet)];
    if (!record) return null;
    // the log exactly as the last checkpoint committed it
    const n = record.logLen ?? 0;
    const segments = logSegments({ ...pet, pendingLog: pet.pendingLog.slice(0, n) })
      .map((s) => ({ brainId: record.brains?.[lessonsKey(s.lessons)] ?? null, words: s.words }))
      .filter((s) => s.words.length > 0);
    return JSON.stringify({ petId: record.petId, words: pet.pendingLog.slice(0, n), segments });
  },
  forget: () => {
    const p = useGame.getState().pet;
    if (p) store(p, null);
    set({ record: null });
  },
}));

// the record on screen follows the pet on screen
useGame.subscribe((s, prev) => {
  if (s.pet?.bornAt !== prev.pet?.bornAt) useChain.setState({ record: activeRecord() });
});
