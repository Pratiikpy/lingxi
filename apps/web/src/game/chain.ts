/**
 * Keeping a pet on X Layer from the browser: connect a wallet, hatch the pet's
 * on-chain twin with its starter brain, and write daily checkpoints.
 *
 * Wallets: an injected wallet (OKX Wallet first, then any EIP-1193 provider).
 * In local development against a fork only, a throwaway test key can stand in
 * (VITE_DEV_KEY); it is never part of a production build.
 */

import { walletNeeded } from "./move";
import { useBadges } from "./badges";
import { create } from "zustand";
import { createPublicClient, createWalletClient, custom, erc20Abi, http, isAddress, type Address, type Hex, type PublicClient, type WalletClient, fallback } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Deployment, type TapeQuote, type TapeStep, allowPartnerOnChain, breedOnChain, breedingTerms, checkPartner, hasConsent, checkpointOnChain, hatchOnChain, quoteTapeout, readKeeping, readPet, setBrainOnChain, setSitterOnChain, signRelay, type SignedRelay, tapeOutYourself, xLayer } from "@lingxi/chain";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { AUTO_DAYS, AUTO_FUND, AUTO_LOW, sessionAccount, sessionWallet } from "./session";
import { type Pet, logSegments, packState, petCard, stageOf, unpackState, ruleSkillIds } from "@lingxi/game";
import { type BrainRelayBody, relayAvailable, relayBrain, relayChild, relayInstinct } from "./api";
import type { ChainInfo } from "./live";
import { programFor, useGame } from "./store";
import localDeployment from "../../../../packages/chain/deployments/local.json";
import xlayerDeployment from "../../../../packages/chain/deployments/xlayer.json";
import { saveWrite } from "./saveRuntime";
// a rehearsal of a mainnet deploy on a local fork of X Layer (VITE_CHAIN=rehearsal, test builds only)
import rehearsalDeployment from "../../../../packages/chain/deployments/rehearsal.json";
import { noteTally } from "./tally";
import { now as gameNow } from "./gameClock";
import { OFFICIAL_RPCS } from "./nodes";

const OLD_KEY = "lingxi.chain.v1";
const CHAIN_KEY = "lingxi.chain.v2";
const LINES = ["gentle", "bold", "curious"] as const;

// X Layer mainnet unless a build asks for a local chain (VITE_CHAIN=local) or a fork rehearsal, so a fresh clone plays
// against the real contracts with no setup
export const NETWORK = (import.meta.env.VITE_CHAIN as string | undefined) || "xlayer";
const DEPLOYMENTS: Record<string, Deployment | undefined> = {
  local: localDeployment as unknown as Deployment,
  xlayer: xlayerDeployment as unknown as Deployment,
  // the condition is a build-time constant, so a production build drops the rehearsal file entirely
  rehearsal: import.meta.env.VITE_CHAIN === "rehearsal" ? (rehearsalDeployment as unknown as Deployment) : undefined,
};
export const deployment: Deployment | undefined = DEPLOYMENTS[NETWORK];
export const explorerTx = (tx: string) => (NETWORK === "local" ? null : `https://www.oklink.com/xlayer/tx/${tx}`);

// VITE_RPC points a test build at a local fork of X Layer; production builds leave it unset
// (an empty value counts as unset, as the on-chain build passes it)
// X Layer's public RPCs. OKX's answers every browser request with CORS headers; rpc.xlayer.tech drops them
// on its rate-limit replies, which the browser then reports as a blocked request, so it is the fallback.
export { OFFICIAL_RPCS };
// With a server of our own (VITE_API_URL), the browser reads X Layer through it, same origin, so a public RPC's
// rate-limit reply can never surface as a blocked request; the public RPCs stay behind it as fallbacks. The
// on-chain copy on DeWEB has no server and talks to the public RPCs directly.
export const API_RPC = (import.meta.env.VITE_API_URL as string | undefined) ? `${import.meta.env.VITE_API_URL as string}/api/rpc` : location.hostname === "localhost" ? "http://localhost:8787/api/rpc" : null;
export const rpcs: string[] = (import.meta.env.VITE_RPC as string | undefined)
  ? [import.meta.env.VITE_RPC as string]
  : NETWORK === "xlayer"
    ? [...(API_RPC ? [API_RPC] : []), ...OFFICIAL_RPCS]
    : [deployment?.rpc ?? "https://xlayerrpc.okx.com"];
const rpc = rpcs[0] ?? "https://xlayerrpc.okx.com";
const chain = { ...xLayer, rpcUrls: { default: { http: rpcs } } };
export const publicClient: PublicClient = createPublicClient({ chain, transport: fallback(rpcs.map((u) => http(u))) }) as PublicClient;
/** One client per official RPC, for spreading heavy read loads (the proof page's full check). */
export const readClients: PublicClient[] =
  NETWORK === "xlayer"
    ? OFFICIAL_RPCS.map((u) => createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [u] } } }, transport: http(u) }) as PublicClient)
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
      params: [{ chainId: "0xc4", chainName: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: OFFICIAL_RPCS, blockExplorerUrls: ["https://www.oklink.com/xlayer"] }],
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
  /** auto-save: this device's key sits the pet on chain until then (seconds) */
  autoUntil?: number;
  /** a friend sits the pet on chain until then (seconds) */
  sitter?: { who: string; until: number };
}

/** Whether auto-save is on now, ending soon, or off. */
export function autoStatus(r: ChainRecord | null, nowMs: number): "on" | "ending" | "off" {
  if (!r?.autoUntil || r.autoUntil * 1000 <= nowMs) return "off";
  return r.autoUntil * 1000 - nowMs < 3 * 86_400_000 ? "ending" : "on";
}

/** The first line of an error, for showing to the player. */
const firstLine = (e: unknown): string => (e as Error).message?.split(/\r?\n/)[0] || "failed";

/**
 * Which taped-out brain a mind needs, by what it was taught and the instincts it
 * hatched with (pets without instincts keep the key they always had).
 */
/** The key a mind's circuit is remembered by: its lessons, its instinct switches, and an owned instinct circuit. */
/** Which brain a record keeps a circuit for. Rule skills (plan 4.4) join the key only when held, so older keys still match. */
export const mindKey = (lessons: unknown[], instincts = 0, outside?: { processor: string; id: string }, skills: readonly number[] = []) => {
  const base = outside ? JSON.stringify({ lessons, instincts, outside: `${outside.processor}:${outside.id}` }) : instincts ? JSON.stringify({ lessons, instincts }) : JSON.stringify(lessons);
  return skills.length ? `${base}|skills:${skills.join(",")}` : base;
};

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
    saveWrite(CHAIN_KEY, JSON.stringify(records));
  } catch {
    // in memory for this visit
  }
}
/** Any pet's chain record on this device, and setting it (pet-sitting moves records between devices). */
export const recordOf = (pet: Pick<Pet, "bornAt">): ChainRecord | null => records[petKey(pet)] ?? null;
/** Every wallet that owns a pet kept on this device (community goals count what these wallets did on chain). */
export const deviceWallets = (): string[] => [...new Set(Object.values(records).map((r) => r.owner.toLowerCase()))].filter((w) => /^0x[0-9a-f]{40}$/.test(w)).slice(0, 8);
export function setRecordOf(pet: Pet, rec: ChainRecord | null): void {
  store(pet, rec);
  useChain.setState({ record: activeRecord() });
}

const activeRecord = () => {
  const p = useGame.getState().pet;
  return p ? (records[petKey(p)] ?? null) : null;
};

interface ChainState {
  record: ChainRecord | null;
  busy: "idle" | "connecting" | "hatching" | "saving" | "taping" | "auto";
  /** what taping out this pet's current mind with the player's own wallet costs */
  quoteSelf: (pet: Pet) => Promise<TapeQuote | null>;
  /** tape out this pet's current mind with the player's own wallet, verify it, and move the pet onto it */
  selfTape: (pet: Pet, q: TapeQuote, onStep: (s: TapeStep | "setBrain") => void) => Promise<boolean>;
  error: string | null;
  keep: (pet: Pet) => Promise<void>;
  /** save today; with `quiet`, only through the auto-save key and never opening the wallet */
  saveToday: (pet: Pet, onSaved: () => void, quiet?: boolean) => Promise<void>;
  /** turn auto-save on (one approval and one small gas top-up) or renew it */
  enableAuto: (pet: Pet) => Promise<void>;
  /** turn auto-save or a friend's sitting off */
  endSitting: (pet: Pet) => Promise<void>;
  /** let a friend's wallet keep the pet's daily saves for a number of days */
  sitWith: (pet: Pet, who: string, days: number) => Promise<boolean>;
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

/**
 * The auto-save key's wallet when it may save this pet right now (sitting on
 * chain, not expired, enough gas), else null. A sitting replaced on chain (a
 * friend now sits the pet) turns auto-save off on this device.
 */
/**
 * Who signs a request for the relayer to tape out this pet's brain: this device's own key when it keeps the pet on
 * chain (no prompt at all), otherwise the owner's wallet, once, with no fee and no transaction.
 */
async function relaySigner(petId: string, wallet?: WalletClient): Promise<{ address: Address; signMessage: (m: { message: string }) => Promise<Hex> }> {
  const key = sessionAccount();
  if (deployment && (await readKeeping(publicClient, deployment, BigInt(petId), key.address).catch(() => null))?.keeper) return key;
  const w = wallet ?? (await connectWallet());
  const account = w.account;
  if (!account) throw new Error("wallet has no account");
  return { address: account.address, signMessage: ({ message }) => w.signMessage({ account, message }) };
}

/**
 * A season entry signed as this pet on X Layer (kind "season"), so the server can prove it and put it in line for the
 * keepsake. Null for a pet that is not on chain. Throws when no keeper can sign (no wallet, or the signature declined).
 */
export async function signSeasonEntry(pet: Pet, entry: unknown): Promise<SignedRelay | null> {
  const record = records[petKey(pet)];
  if (!deployment || !record) return null;
  return signRelay(await relaySigner(record.petId), "season", record.petId, entry);
}

async function autoWallet(pet: Pet, record: ChainRecord): Promise<WalletClient | null> {
  if (!deployment || autoStatus(record, gameNow()) === "off") return null;
  const key = sessionAccount().address;
  const [k, balance] = await Promise.all([readKeeping(publicClient, deployment, BigInt(record.petId), key), publicClient.getBalance({ address: key })]);
  if (!k.keeper) {
    store(pet, { ...record, autoUntil: undefined });
    useChain.setState({ record: activeRecord() });
    return null;
  }
  if (balance < AUTO_LOW) return null;
  return sessionWallet(chain, rpc);
}

/** Whether the auto-save key is running low on gas. */
export async function autoGasLow(): Promise<boolean> {
  return (await publicClient.getBalance({ address: sessionAccount().address })) < AUTO_LOW;
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
    set({ busy: "connecting", error: null });
    try {
      // the wallet and the fee come first: a child circuit is taped out only for a birth that can go through
      const wallet = await connectWallet();
      const terms = await breedingTerms(publicClient, deployment, [BigInt(r.petId), BigInt(partner.petId)]);
      if (terms) {
        if (terms.childrenLeft.some((n) => n <= 0)) throw new Error("TooManyChildren");
        const held = (await publicClient.readContract({ address: terms.bem, abi: erc20Abi, functionName: "balanceOf", args: [wallet.account!.address] })) as bigint;
        if (held < terms.fee) throw new Error("not enough BEM");
      }
      // the partner's pet, owner and brain as they told us are checked on chain, and its consent must stand, before
      // the child circuit is taped out: nothing is spent on a partner's word alone
      if ((await checkPartner(publicClient, deployment, partner)) !== "ok") throw new Error("PartnerNotOnChain");
      if (!(await hasConsent(publicClient, deployment, BigInt(partner.petId), wallet.account!.address))) throw new Error("NoConsent");
      set({ busy: "taping" });
      const relayed = await relayChild(await signRelay(await relaySigner(r.petId, wallet), "child", r.petId, { parents: [mine, partner.brain] }));
      if (!relayed.ok) throw new Error(relayed.reason);
      set({ busy: "hatching" });
      const { childId, tx } = await breedOnChain(publicClient, wallet, deployment, BigInt(r.petId), BigInt(partner.petId), deployment.processor, BigInt(relayed.brainId), LINES.indexOf(child.line));
      const onChain = await readPet(publicClient, deployment, childId);
      store(child, {
        petId: childId.toString(),
        hatchTx: tx,
        lastDay: 0,
        owner: wallet.account!.address,
        bornChain: onChain.born,
        brains: { [mindKey([])]: relayed.brainId },
        brainKey: mindKey([]),
      });
      set({ busy: "idle", record: activeRecord() });
      return { ok: true, memory: unpackState(onChain.state, onChain.brainBits).brain };
    } catch (e) {
      const msg = firstLine(e);
      set({ busy: "idle", error: msg });
      return {
        ok: false,
        reason: /NotAdult/.test(msg)
          ? "notAdultOnChain"
          : /TooSoon/.test(msg)
            ? "tooSoon"
            : /NoConsent/.test(msg)
              ? "noConsent"
              : /PartnerNotOnChain/.test(msg)
                ? "partnerNotOnChain"
              : /TooManyChildren/.test(msg)
                ? "tooManyChildren"
                : /not enough BEM/.test(msg)
                  ? "notEnoughBem"
                  : msg,
      };
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
      const { petId, tx } = await hatchOnChain(publicClient, wallet, deployment, line, pet.line, packState(pet, stageOf(pet, gameNow())));
      const onChain = await readPet(publicClient, deployment, petId);
      const record: ChainRecord = {
        petId: petId.toString(),
        hatchTx: tx,
        lastDay: 0,
        owner: wallet.account!.address,
        bornChain: onChain.born,
        brains: { [mindKey([])]: deployment.circuits[pet.line]!.id },
        brainKey: mindKey([]),
      };
      store(pet, record);
      // the registry hatches every pet on its line's starter brain; a pet with
      // instincts moves straight onto its own circuit before anything is saved
      if (pet.instincts && relayAvailable()) {
        set({ busy: "taping" });
        const body: BrainRelayBody = { line: pet.line, lessons: pet.lessons, instincts: pet.instincts, skills: ruleSkillIds(pet.growth) };
        const r = await relayBrain(await signRelay(await relaySigner(petId.toString(), wallet), "brain", petId.toString(), body));
        if (!r.ok) throw new Error(r.reason);
        set({ busy: "saving" });
        await setBrainOnChain(publicClient, wallet, deployment, petId, deployment.processor, BigInt(r.brainId));
        const key = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
        store(pet, { ...record, brains: { ...record.brains, [key]: r.brainId }, brainKey: key });
      }
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: (e as Error).message.split("\n")[0] ?? "failed" });
    }
  },
  saveToday: async (pet, onSaved, quiet = false) => {
    const record = records[petKey(pet)];
    // a pet away (with a friend, or waiting at the adoption centre, whose offer fixes its saved record) is not saved
    if (!deployment || !record || get().busy !== "idle" || pet.away) return;
    set({ busy: quiet ? "auto" : "connecting", error: null });
    try {
      const auto = await autoWallet(pet, record);
      if (!auto && quiet) return set({ busy: "idle" });
      const wallet = auto ?? (await connectWallet());
      set({ busy: quiet ? "auto" : "saving" });
      // days are counted the way PetRegistry counts them: from block time, not this computer's clock
      const blockMs = Number((await publicClient.getBlock()).timestamp) * 1000;
      const day = chainDay(record, blockMs);
      if (day <= record.lastDay) {
        set({ busy: "idle", error: quiet ? null : "alreadySaved" });
        return;
      }
      const tx = await checkpointOnChain(publicClient, wallet, deployment, BigInt(record.petId), day, packState(pet, stageOf(pet, gameNow())), pet.logHash as Hex);
      const next = { ...(records[petKey(pet)] ?? record), lastDay: day, lastTx: tx, logLen: pet.pendingLog.length };
      store(pet, next);
      set({ record: activeRecord(), busy: "idle" });
      useBadges.getState().note("chainDays");
      noteTally("SAVE");
      onSaved();
    } catch (e) {
      set({ busy: "idle", error: quiet ? null : firstLine(e) });
    }
  },
  enableAuto: async (pet) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      const key = sessionAccount().address;
      const now = Number((await publicClient.getBlock()).timestamp);
      // a little under the contract's 30-day limit, so the block that includes it is never past it
      const until = now + AUTO_DAYS * 86_400 - 600;
      await setSitterOnChain(publicClient, wallet, deployment, BigInt(record.petId), key, BigInt(until));
      const balance = await publicClient.getBalance({ address: key });
      if (balance < AUTO_FUND / 2n) {
        const tx = await wallet.sendTransaction({ to: key, value: AUTO_FUND - balance, account: wallet.account!, chain });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }
      store(pet, { ...record, autoUntil: until, sitter: undefined });
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: firstLine(e) });
    }
  },
  endSitting: async (pet) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      await setSitterOnChain(publicClient, wallet, deployment, BigInt(record.petId), "0x0000000000000000000000000000000000000000", 0n);
      store(pet, { ...record, autoUntil: undefined, sitter: undefined });
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: firstLine(e) });
    }
  },
  sitWith: async (pet, who, days) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return false;
    if (!isAddress(who)) {
      set({ error: "badAddress" });
      return false;
    }
    if (!(days >= 1 && days <= 30)) {
      set({ error: "badDays" });
      return false;
    }
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      if (who.toLowerCase() === wallet.account!.address.toLowerCase()) throw new Error("selfSitter");
      set({ busy: "saving" });
      const now = Number((await publicClient.getBlock()).timestamp);
      const until = now + Math.round(days) * 86_400 - 600;
      await setSitterOnChain(publicClient, wallet, deployment, BigInt(record.petId), who as Hex, BigInt(until));
      store(pet, { ...record, autoUntil: undefined, sitter: { who, until } });
      set({ record: activeRecord(), busy: "idle" });
      return true;
    } catch (e) {
      const msg = firstLine(e);
      set({ busy: "idle", error: msg === "selfSitter" ? "selfSitter" : msg });
      return false;
    }
  },
  quoteSelf: async (pet) => {
    if (!deployment || pet.family) return null;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      const net = compileProgram(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth));
      const q = await quoteTapeout(publicClient, deployment.processor, wallet.account!.address, net.gates.length, net.latches.length, netlistBytes(net).length);
      set({ busy: "idle" });
      return q;
    } catch (e) {
      set({ busy: "idle", error: firstLine(e) });
      return null;
    }
  },
  selfTape: async (pet, q, onStep) => {
    const record = records[petKey(pet)];
    if (!deployment || !record || pet.family) return false;
    set({ busy: "taping", error: null });
    try {
      const wallet = await connectWallet();
      const bytes = netlistBytes(compileProgram(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth)));
      const { brainId } = await tapeOutYourself(publicClient, wallet, deployment.processor, bytes, q, onStep);
      onStep("setBrain");
      set({ busy: "saving" });
      await setBrainOnChain(publicClient, wallet, deployment, BigInt(record.petId), deployment.processor, brainId);
      const key = mindKey(pet.lessons, pet.instincts);
      store(pet, { ...record, brains: { ...(record.brains ?? {}), [key]: brainId.toString() }, brainKey: key });
      set({ record: activeRecord(), busy: "idle" });
      return true;
    } catch (e) {
      set({ busy: "idle", error: firstLine(e) });
      return false;
    }
  },
  updateMind: async (pet) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const key = mindKey(pet.lessons, pet.instincts, pet.outside, ruleSkillIds(pet.growth));
      let brainId = record.brains?.[key];
      if (!brainId) {
        set({ busy: "taping" });
        // a child's mind is both halves, REF'd by a new child circuit
        const { outside: _o, ...plain } = pet;
        const ownKey = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
        let ownId = record.brains?.[ownKey];
        if (!ownId) {
          const signer = await relaySigner(record.petId);
          const r = pet.family
            ? await relayChild(await signRelay(signer, "child", record.petId, { card: petCard(plain) }))
            : await relayBrain(await signRelay(signer, "brain", record.petId, { line: pet.line, lessons: pet.lessons, ...(pet.instincts ? { instincts: pet.instincts } : {}), skills: ruleSkillIds(pet.growth) } satisfies BrainRelayBody));
          if (!r.ok) throw new Error(r.reason);
          ownId = r.brainId;
        }
        brainId = ownId;
        // an owned instinct: a circuit that REFs the pet's own brain and the owned one
        if (pet.outside) {
          const r = await relayInstinct(await signRelay(await relaySigner(record.petId), "instinct", record.petId, { own: ownId, processor: pet.outside.processor, id: pet.outside.id }));
          if (!r.ok) throw new Error(r.reason);
          brainId = r.brainId;
        }
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
      .map((s) => ({ brainId: record.brains?.[mindKey(s.lessons, pet.instincts, s.outside, s.skills)] ?? null, words: s.words }))
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
