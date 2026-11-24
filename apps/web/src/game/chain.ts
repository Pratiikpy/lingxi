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
import { erc20Abi, isAddress, type Address, type Hex, type WalletClient } from "viem";
import { viem } from "./chainClient";
import {
  petRegistryAbi,
  type Deployment,
  type TapeQuote,
  type TapeStep,
  allowPartnerOnChain,
  consentStands,
  withdrawConsentOnChain,
  breedOnChain,
  breedingTerms,
  checkPartner,
  hasConsent,
  checkpointOnChain,
  hatchOnChain,
  quoteTapeout,
  readKeeping,
  readPet,
  setBrainOnChain,
  setSitterOnChain,
  signRelay,
  type SignedRelay,
  tapeOutYourself,
  refusesTokens,
  LineMismatchError,
  RevertedOnChain,
  StillPending,
  hatchOutcome,
  birthOutcome,
  revertName,
  breederV2Abi,
  signSponsorRequest,
} from "@lingxi/chain";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { AUTO_DAYS, AUTO_FUND, AUTO_LOW, sessionAccount, sessionWallet } from "./session";
import {
  type Pet,
  logSegments,
  packState,
  petCard,
  restartLog,
  stageOf,
  unpackState,
  ruleSkillIds,
} from "@lingxi/game";
import type { BrainRelayPayload } from "@lingxi/api-schema";
import { relayAvailable, relayBrain, relayChild, relayInstinct, signRelayRequest } from "./api";
import type { ChainInfo } from "./live";
import { diaryBody } from "./requests";
import { programFor, useGame, whenKeptOnChain } from "./store";
import { saveWrite } from "./saveRuntime";
import { noteTally } from "./tally";
import { now as gameNow } from "./gameClock";
import { firstLine } from "./errorText";

const OLD_KEY = "lingxi.chain.v1";
const CHAIN_KEY = "lingxi.chain.v2";
const LINES = ["gentle", "bold", "curious"] as const;

export { API_RPC, NETWORK, OFFICIAL_RPCS, deployment, explorerTx, publicClient, rpcs, walletAddress } from "./network";
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
  /**
   * kept for free (H4): the pet is owned by this device's own key, which saves it with the gas the game sent it, until
   * the player moves it to a wallet
   */
  device?: boolean;
}

/** Whether auto-save is on now, ending soon, or off. */
export function autoStatus(r: ChainRecord | null, nowMs: number): "on" | "ending" | "off" {
  // a pet this device's key owns is always saved by it
  if (r?.device) return "on";
  if (!r?.autoUntil || r.autoUntil * 1000 <= nowMs) return "off";
  return r.autoUntil * 1000 - nowMs < 3 * 86_400_000 ? "ending" : "on";
}

/** The registry's refusals the chain panel explains, by the contract's own error name (A19). */
const REGISTRY_REFUSALS: Record<string, string> = {
  DayNotAfter: "alreadySaved",
  NotKeeper: "notKeeping",
  SittingTooLong: "badDays",
};

/**
 * What the chain panel says about a failed write: the contract's own reason when it gave one (read from the decoded
 * error, never from the message's first line, which is viem's "The contract function ... reverted."), else that
 * first line.
 */
function chainReason(e: unknown): string {
  if (refusesTokens(e)) return "cannotReceive";
  if (e instanceof LineMismatchError) return "notThisPet";
  // sent, mined and turned down: its network fee was spent, so the panel must not say nothing was charged (A22)
  if (e instanceof RevertedOnChain) return "revertedOnChain";
  const refused = revertName(e, petRegistryAbi);
  return (refused && REGISTRY_REFUSALS[refused]) || firstLine(e);
}

/** The Breeder's refusals the Family screen explains, by the contract's own error name (A19). */
const BREED_REFUSALS: Record<string, string> = {
  NotAdult: "notAdultOnChain",
  TooSoon: "tooSoon",
  NoConsent: "noConsent",
  TooManyChildren: "tooManyChildren",
  FeeMoved: "feeMoved",
  NotYours: "notYours",
};

/**
 * Which taped-out brain a mind needs, by what it was taught and the instincts it
 * hatched with (pets without instincts keep the key they always had).
 */
/** The key a mind's circuit is remembered by: its lessons, its instinct switches, and an owned instinct circuit. */
/** Which brain a record keeps a circuit for. Rule skills (plan 4.4) join the key only when held, so older keys still match. */
export const mindKey = (
  lessons: unknown[],
  instincts = 0,
  outside?: { processor: string; id: string },
  skills: readonly number[] = [],
) => {
  const base = outside
    ? JSON.stringify({ lessons, instincts, outside: `${outside.processor}:${outside.id}` })
    : instincts
      ? JSON.stringify({ lessons, instincts })
      : JSON.stringify(lessons);
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
/**
 * Hatches sent but not yet confirmed, by pet (A30): kept the moment a hatch is sent, so a keep that timed out never sends
 * a second one; cleared once X Layer has said what became of it.
 */
const PENDING_KEY = "lingxi.chain.pending.v1";
/** A hatch the node has never heard of is let go after this long (it was dropped, or never left the wallet). */
const PENDING_FORGET_MS = 30 * 60_000;
interface PendingHatch {
  tx: Hex;
  owner: string;
  at: number;
  /** how many words the log held, and the memory, when the hatch's state was taken (A66); absent on older entries */
  n?: number;
  memory?: number[];
}
function loadPending(): Record<string, PendingHatch> {
  try {
    const r = localStorage.getItem(PENDING_KEY);
    return r ? (JSON.parse(r) as Record<string, PendingHatch>) : {};
  } catch {
    return {};
  }
}
let pending = loadPending();
function setPending(pet: Pet, p: PendingHatch | null): void {
  const next = { ...pending };
  if (p) next[petKey(pet)] = p;
  else delete next[petKey(pet)];
  pending = next;
  try {
    saveWrite(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // in memory for this visit
  }
}

/**
 * Births sent but not yet recorded, by parent (A48): kept the moment the wallet sends one, with the child it is for, so
 * a birth slow to confirm is never sent again and a birth found after the page closed still brings its child home.
 */
const BIRTHS_KEY = "lingxi.chain.births.v1";
interface PendingBirth {
  tx: Hex;
  owner: string;
  at: number;
  brainId: string;
  child: Pet;
}
function loadBirths(): Record<string, PendingBirth> {
  try {
    const r = localStorage.getItem(BIRTHS_KEY);
    return r ? (JSON.parse(r) as Record<string, PendingBirth>) : {};
  } catch {
    return {};
  }
}
let births = loadBirths();
function setBirth(parentKey: string, b: PendingBirth | null): void {
  const next = { ...births };
  if (b) next[parentKey] = b;
  else delete next[parentKey];
  births = next;
  try {
    saveWrite(BIRTHS_KEY, JSON.stringify(births));
  } catch {
    // in memory for this visit
  }
}
/**
 * Consents this device gave, by pet (A63): listed on the pet sheet at once, before the server's index of the breeders'
 * events reaches them. Each is confirmed with the breeder's own view before it is shown.
 */
const CONSENTS_KEY = "lingxi.chain.consents.v1";
/** A breeding consent standing on X Layer: the breeder it is on and the wallet it lets raise one little one. */
export interface GivenConsent {
  breeder: Address;
  partner: Address;
}
function loadGiven(): Record<string, GivenConsent[]> {
  try {
    const r = localStorage.getItem(CONSENTS_KEY);
    return r ? (JSON.parse(r) as Record<string, GivenConsent[]>) : {};
  } catch {
    return {};
  }
}
let given = loadGiven();
function setGiven(key: string, list: GivenConsent[]): void {
  const next = { ...given };
  if (list.length) next[key] = list;
  else delete next[key];
  given = next;
  try {
    saveWrite(CONSENTS_KEY, JSON.stringify(given));
  } catch {
    // in memory for this visit
  }
}
const sameConsent = (a: GivenConsent, b: GivenConsent) =>
  a.breeder.toLowerCase() === b.breeder.toLowerCase() && a.partner.toLowerCase() === b.partner.toLowerCase();
/** Only the deployment's own breeders: an address from the server is never called unless it is one of them. */
const breedersHere = (): Address[] => [deployment?.breeder, deployment?.breederFree].filter((a): a is Address => !!a);
const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");

type KeptFree =
  | { ok: true; petId: string | null; hatchTx: string | null; grantTx: string | null }
  | { ok: false; reason: string };

/** Asks the server to keep this pet on X Layer for this device's key (H4), signed by that key. */
async function askToKeep(key: Awaited<ReturnType<typeof sessionAccount>>, pet: Pet): Promise<KeptFree> {
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
async function keptFor(address: string): Promise<{ petId: string; hatchTx: string } | null> {
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
const INDEX_BEHIND_OK = 600;

/** A child's record, from the birth that made it. */
async function birthRecord(
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

/** Any pet's chain record on this device, and setting it (pet-sitting moves records between devices). */
export const recordOf = (pet: Pick<Pet, "bornAt">): ChainRecord | null => records[petKey(pet)] ?? null;
// the store cuts only the logs of pets not kept here (A148)
whenKeptOnChain((p) => recordOf(p) !== null);
/** Every wallet that owns a pet kept on this device (community goals count what these wallets did on chain). */
export const deviceWallets = (): string[] =>
  [...new Set(Object.values(records).map((r) => r.owner.toLowerCase()))]
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w))
    .slice(0, 8);
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
  /** whether the server keeps pets on X Layer for players with no wallet (H4); null until asked */
  freeOn: boolean | null;
  checkFree: () => Promise<void>;
  /** keep the pet on X Layer for free: hatched to this device's own key, which then saves it with gas the game sends */
  keepFree: (pet: Pet) => Promise<void>;
  /** move a pet this device's key owns to the player's own wallet: one transfer, signed by this device's key */
  moveToWallet: (pet: Pet) => Promise<boolean>;
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
  /**
   * the consents standing for this pet on X Layer, each confirmed on its breeder (A63); `partial` when the server's
   * index of older ones has not caught up; null when X Layer cannot be read
   */
  consentsOf: (pet: Pet) => Promise<{ consents: GivenConsent[]; partial: boolean } | null>;
  /** withdraw a consent not yet used (A63) */
  withdraw: (pet: Pet, c: GivenConsent) => Promise<boolean>;
  /**
   * hatch the newborn through the Breeder, then save its first day; returns the child's memory as the chain mixed it,
   * and whether its first day was saved (A33)
   */
  breed: (
    parent: Pet,
    partner: ChainInfo,
    child: Pet,
  ) => Promise<{ ok: true; memory: number[]; firstDay: boolean } | { ok: false; reason: string }>;
  /** births sent before the page closed and found on X Layer since: recorded, and their children handed back to join the pets (A48) */
  finishBirths: () => Promise<Array<{ child: Pet; memory: number[] }>>;
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
async function relaySigner(
  petId: string,
  wallet?: WalletClient,
): Promise<{ address: Address; signMessage: (m: { message: string }) => Promise<Hex> }> {
  const key = await sessionAccount();
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

async function autoWallet(pet: Pet, record: ChainRecord): Promise<WalletClient | null> {
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
    useChain.setState({ record: activeRecord() });
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
async function saveFirstDay(wallet: WalletClient, record: ChainRecord, pet: Pet): Promise<boolean> {
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

export const useChain = create<ChainState>((set, get) => ({
  record: activeRecord(),
  freeOn: null,
  checkFree: async () => {
    // the on-chain copy has no server, so nothing is kept for free there
    if (!API_BASE || !deployment) return set({ freeOn: false });
    try {
      const r = (await (await fetch(`${API_BASE}/api/sponsor`)).json()) as { ok?: boolean; on?: boolean };
      set({ freeOn: r.ok === true && r.on === true });
    } catch {
      set({ freeOn: false });
    }
  },
  keepFree: async (pet) => {
    if (!deployment) return set({ error: "notDeployed" });
    if (get().busy !== "idle" || pet.family) return;
    set({ busy: "hatching", error: null });
    try {
      const key = await sessionAccount();
      let record = records[petKey(pet)] ?? null;
      // the state the hatch records and the log's length at that moment, taken together from the same pet
      const start = { n: pet.pendingLog.length, memory: pet.brain.slice() };
      const asked = await askToKeep(key, pet);
      if (!asked.ok) {
        // an answer lost on the way: the server remembers this key's pet, and X Layer says whose it is
        if (asked.reason !== "had" || record)
          return set({ busy: "idle", error: `free.${asked.reason}`, record: activeRecord() });
      }
      const known = asked.ok && asked.petId && asked.hatchTx ? asked : await keptFor(key.address);
      if (!record) {
        if (!known?.petId || !known.hatchTx) return set({ busy: "idle", error: "free.error" });
        // the chain's word, never the server's: the pet must be this device's
        const onChain = await readPet(publicClient, deployment, BigInt(known.petId));
        if (onChain.owner.toLowerCase() !== key.address.toLowerCase())
          return set({ busy: "idle", error: "free.notOurs" });
        record = {
          petId: known.petId,
          hatchTx: known.hatchTx,
          lastDay: 0,
          owner: key.address,
          bornChain: onChain.born,
          brains: { [mindKey([])]: deployment.circuits[pet.line]!.id },
          brainKey: mindKey([]),
          device: true,
        };
        store(pet, record);
        // its log now starts where the hatch took its state, which is where the chain's proof of its memory starts (A66)
        if (asked.ok) useGame.getState().rework(pet.bornAt, (p) => restartLog(p, start.n, start.memory));
        set({ record: activeRecord() });
      }
      const gas = await publicClient.getBalance({ address: key.address });
      if (gas < AUTO_LOW) return set({ busy: "idle", error: "free.noGas", record: activeRecord() });
      // a pet with instincts moves onto its own circuit, signed and paid by this device's key
      const mind = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
      if (pet.instincts && relayAvailable() && record.brainKey !== mind) {
        set({ busy: "taping" });
        const body: BrainRelayPayload = {
          line: pet.line,
          lessons: pet.lessons,
          instincts: pet.instincts,
          skills: ruleSkillIds(pet.growth),
        };
        const r = await relayBrain(await signRelayRequest(key, "brain", record.petId, body));
        if (!r.ok) throw new Error(r.reason);
        set({ busy: "saving" });
        await setBrainOnChain(
          publicClient,
          await sessionWallet(chain, rpc),
          deployment,
          BigInt(record.petId),
          deployment.processor,
          BigInt(r.brainId),
        );
        store(pet, { ...record, brains: { ...record.brains, [mind]: r.brainId }, brainKey: mind });
      }
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: chainReason(e), record: activeRecord() });
    }
  },
  moveToWallet: async (pet) => {
    const r = records[petKey(pet)];
    if (!deployment || !r?.device || get().busy !== "idle") return false;
    set({ busy: "connecting", error: null });
    try {
      const to = (await connectWallet()).account!.address;
      set({ busy: "saving" });
      const key = await sessionAccount();
      // a plain transfer from this device's key: the wallet signs nothing and pays nothing
      const { request } = await publicClient.simulateContract({
        address: deployment.registry,
        abi: petRegistryAbi,
        functionName: "transferFrom",
        args: [key.address, to, BigInt(r.petId)],
        account: key,
      });
      const tx = await (await sessionWallet(chain, rpc)).writeContract(request);
      const mined = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (mined.status !== "success") throw new Error("the move was turned down on chain");
      const { device: _device, ...rest } = r;
      store(pet, { ...rest, owner: to, lastTx: tx });
      set({ busy: "idle", record: activeRecord() });
      return true;
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
      return false;
    }
  },
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
      const c = { breeder: deployment.breeder, partner: partnerOwner as Address };
      const held = given[petKey(pet)] ?? [];
      if (!held.some((x) => sameConsent(x, c))) setGiven(petKey(pet), [...held, c]);
      set({ busy: "idle" });
      return true;
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
      return false;
    }
  },
  consentsOf: async (pet) => {
    const r = records[petKey(pet)];
    if (!deployment || !r) return { consents: [], partial: false };
    const known = breedersHere().map((a) => a.toLowerCase());
    const candidates: GivenConsent[] = [...(given[petKey(pet)] ?? [])];
    let partial = true;
    try {
      const res = await fetch(`${API_BASE}/api/consents/${r.petId}`);
      const body = (await res.json()) as {
        ok: boolean;
        indexedTo?: number;
        consents?: Array<{ breeder: string; partner: string }>;
      };
      if (body.ok && Array.isArray(body.consents)) {
        for (const c of body.consents) {
          if (!known.includes(c.breeder.toLowerCase()) || !isAddress(c.partner)) continue;
          const x = { breeder: c.breeder as Address, partner: c.partner as Address };
          if (!candidates.some((y) => sameConsent(x, y))) candidates.push(x);
        }
        const head = Number(await publicClient.getBlockNumber());
        partial = typeof body.indexedTo !== "number" || head - body.indexedTo > INDEX_BEHIND_OK;
      }
    } catch {
      // the server's list is only a help: the consents this device gave are still checked below
    }
    try {
      const standing = await Promise.all(
        candidates.map((c) => consentStands(publicClient, c.breeder, BigInt(r.petId), c.partner)),
      );
      const consents = candidates.filter((_, i) => standing[i]);
      // one this device gave that no longer stands (used, withdrawn, the pet sold) is forgotten
      setGiven(
        petKey(pet),
        (given[petKey(pet)] ?? []).filter((x) => consents.some((y) => sameConsent(x, y))),
      );
      return { consents, partial };
    } catch {
      return null;
    }
  },
  withdraw: async (pet, c) => {
    const r = records[petKey(pet)];
    if (!deployment || !r || !breedersHere().some((a) => a.toLowerCase() === c.breeder.toLowerCase())) return false;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      await withdrawConsentOnChain(publicClient, wallet, c.breeder, BigInt(r.petId), c.partner);
      setGiven(
        petKey(pet),
        (given[petKey(pet)] ?? []).filter((x) => !sameConsent(x, c)),
      );
      set({ busy: "idle" });
      return true;
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
      return false;
    }
  },
  finishBirths: async () => {
    const out: Array<{ child: Pet; memory: number[] }> = [];
    if (!deployment) return out;
    for (const [parentKey, b] of Object.entries(births)) {
      try {
        const o = await birthOutcome(publicClient, b.tx);
        if (typeof o === "object") {
          const { record, memory } = await birthRecord(o.childId, b.tx, b.owner, b.brainId);
          store(b.child, record);
          setBirth(parentKey, null);
          out.push({
            child: { ...b.child, brain: memory.length === b.child.brain.length ? memory : b.child.brain },
            memory,
          });
        } else if (o === "failed" || (o === "unknown" && Date.now() - b.at >= PENDING_FORGET_MS))
          setBirth(parentKey, null);
      } catch {
        // the node did not answer: asked again next time
      }
    }
    return out;
  },
  breed: async (parent, partner, child) => {
    const r = records[petKey(parent)];
    const mine = r?.brains?.[r.brainKey ?? ""];
    if (!deployment?.breeder || !r || !mine) return { ok: false, reason: "offChain" };
    set({ busy: "connecting", error: null });
    try {
      // a birth sent before and not yet recorded is asked about first, never sent again (A48)
      const sentBefore = births[petKey(parent)] ?? null;
      if (sentBefore) {
        set({ busy: "hatching" });
        // a check X Layer could not answer is never taken for a birth that was not sent (A82)
        const out = await birthOutcome(publicClient, sentBefore.tx).catch(() => "unchecked" as const);
        if (out === "unchecked") {
          set({ busy: "idle", error: "birthUnchecked" });
          return { ok: false, reason: "birthUnchecked" };
        }
        if (out === "pending" || (out === "unknown" && Date.now() - sentBefore.at < PENDING_FORGET_MS)) {
          set({ busy: "idle", error: "birthPending" });
          return { ok: false, reason: "birthPending" };
        }
        if (typeof out === "object") {
          const { record: born, memory } = await birthRecord(
            out.childId,
            sentBefore.tx,
            sentBefore.owner,
            sentBefore.brainId,
          );
          store(child, born);
          setBirth(petKey(parent), null);
          set({ busy: "saving" });
          const firstDay = await saveFirstDay(await connectWallet(), born, { ...child, brain: memory });
          set({ busy: "idle", record: activeRecord() });
          return { ok: true, memory, firstDay };
        }
        setBirth(petKey(parent), null);
      }
      // the wallet and the fee come first: a child circuit is taped out only for a birth that can go through
      const wallet = await connectWallet();
      const terms = await breedingTerms(publicClient, deployment, [BigInt(r.petId), BigInt(partner.petId)]);
      if (terms) {
        if (terms.childrenLeft.some((n) => n <= 0)) throw new Error("TooManyChildren");
        const held = (await publicClient.readContract({
          address: terms.bem,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet.account!.address],
        })) as bigint;
        if (held < terms.fee) throw new Error("not enough BEM");
      }
      // the partner's pet, owner and brain as they told us are checked on chain, and its consent must stand, before
      // the child circuit is taped out: nothing is spent on a partner's word alone
      if ((await checkPartner(publicClient, deployment, partner)) !== "ok") throw new Error("PartnerNotOnChain");
      if (!(await hasConsent(publicClient, deployment, BigInt(partner.petId), wallet.account!.address)))
        throw new Error("NoConsent");
      set({ busy: "taping" });
      const relayed = await relayChild(
        await signRelayRequest(await relaySigner(r.petId, wallet), "child", r.petId, {
          parents: [mine, partner.brain],
        }),
      );
      if (!relayed.ok) throw new Error(relayed.reason);
      set({ busy: "hatching" });
      const owner = wallet.account!.address;
      const { childId, tx } = await breedOnChain(
        publicClient,
        wallet,
        deployment,
        BigInt(r.petId),
        BigInt(partner.petId),
        deployment.processor,
        BigInt(relayed.brainId),
        LINES.indexOf(child.line),
        (sent) => setBirth(petKey(parent), { tx: sent, owner, at: Date.now(), brainId: relayed.brainId, child }),
      );
      const { record: born, memory } = await birthRecord(childId, tx, owner, relayed.brainId);
      store(child, born);
      setBirth(petKey(parent), null);
      set({ busy: "saving" });
      const firstDay = await saveFirstDay(wallet, born, { ...child, brain: memory });
      set({ busy: "idle", record: activeRecord() });
      return { ok: true, memory, firstDay };
    } catch (e) {
      // sent and not yet confirmed: kept, and asked about when Welcome is pressed again (A48)
      if (e instanceof StillPending) {
        set({ busy: "idle", error: "birthPending" });
        return { ok: false, reason: "birthPending" };
      }
      const msg = firstLine(e);
      set({ busy: "idle", error: msg });
      // the Breeder's own reason, read from the decoded error, not the message's first line (A19)
      const refused = revertName(e, breederV2Abi);
      return {
        ok: false,
        reason: refusesTokens(e)
          ? "cannotReceive"
          : refused && refused in BREED_REFUSALS
            ? BREED_REFUSALS[refused]!
            : /PartnerNotOnChain/.test(msg)
              ? "partnerNotOnChain"
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
    // a second press while a keep is under way does nothing: one pet, one hatch (A20)
    if (get().busy !== "idle") return;
    set({ busy: "connecting", error: null });
    try {
      // a pet this device has kept already is never hatched again; keeping it again finishes what is left (A20)
      let record = records[petKey(pet)] ?? null;
      const recordFrom = async (
        petId: bigint,
        tx: Hex,
        owner: string,
        start?: { n?: number; memory?: number[] },
      ): Promise<ChainRecord> => {
        const onChain = await readPet(publicClient, deployment, petId);
        const rec: ChainRecord = {
          petId: petId.toString(),
          hatchTx: tx,
          lastDay: 0,
          owner,
          bornChain: onChain.born,
          brains: { [mindKey([])]: deployment.circuits[pet.line]!.id },
          brainKey: mindKey([]),
        };
        store(pet, rec);
        // its log now starts where the hatch took its state, which is where the chain's proof of its memory starts (A66)
        if (start?.n !== undefined && start.memory)
          useGame.getState().rework(pet.bornAt, (p) => restartLog(p, start.n!, start.memory!));
        setPending(pet, null);
        // from here on the panel shows the pet as kept, whatever fails after
        set({ record: activeRecord() });
        return rec;
      };
      // a hatch sent before and not yet confirmed is asked about first, never sent again (A30)
      const sent = record ? null : (pending[petKey(pet)] ?? null);
      if (sent) {
        set({ busy: "hatching" });
        // a check X Layer could not answer is never taken for a hatch that was not sent (A82)
        const out = await hatchOutcome(publicClient, deployment, sent.tx, sent.owner as Hex).catch(
          () => "unchecked" as const,
        );
        if (out === "unchecked") return set({ busy: "idle", error: "hatchUnchecked" });
        if (out === "pending" || (out === "unknown" && Date.now() - sent.at < PENDING_FORGET_MS))
          return set({ busy: "idle", error: "hatchPending" });
        if (typeof out === "object") record = await recordFrom(out.petId, sent.tx, sent.owner, sent);
        else setPending(pet, null);
      }
      const wallet = await connectWallet();
      if (!record) {
        set({ busy: "hatching" });
        const owner = wallet.account!.address;
        // the state the hatch records and the log's length at that moment, taken together from the same pet
        const start = { n: pet.pendingLog.length, memory: pet.brain.slice() };
        const { petId, tx } = await hatchOnChain(
          publicClient,
          wallet,
          deployment,
          pet.line,
          packState(pet, stageOf(pet, gameNow())),
          (tx) => setPending(pet, { tx, owner, at: Date.now(), ...start }),
        );
        record = await recordFrom(petId, tx, owner, start);
      }
      // the registry hatches every pet on its line's starter brain; a pet with
      // instincts moves straight onto its own circuit before anything is saved
      const key = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
      if (pet.instincts && relayAvailable() && record.brainKey !== key) {
        set({ busy: "taping" });
        const body: BrainRelayPayload = {
          line: pet.line,
          lessons: pet.lessons,
          instincts: pet.instincts,
          skills: ruleSkillIds(pet.growth),
        };
        const r = await relayBrain(
          await signRelayRequest(await relaySigner(record.petId, wallet), "brain", record.petId, body),
        );
        if (!r.ok) throw new Error(r.reason);
        set({ busy: "saving" });
        await setBrainOnChain(
          publicClient,
          wallet,
          deployment,
          BigInt(record.petId),
          deployment.processor,
          BigInt(r.brainId),
        );
        store(pet, { ...record, brains: { ...record.brains, [key]: r.brainId }, brainKey: key });
      }
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      // an address whose code refuses tokens is told so (A13), a contract's own reason is said (A19); a hatch that
      // landed before the failure stays shown as kept (A20); one sent and not yet confirmed is said so (A30)
      set({ busy: "idle", error: e instanceof StillPending ? "hatchPending" : chainReason(e), record: activeRecord() });
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
      const tx = await checkpointOnChain(
        publicClient,
        wallet,
        deployment,
        BigInt(record.petId),
        day,
        packState(pet, stageOf(pet, gameNow())),
        pet.logHash as Hex,
      );
      const next = { ...(records[petKey(pet)] ?? record), lastDay: day, lastTx: tx, logLen: pet.pendingLog.length };
      store(pet, next);
      set({ record: activeRecord(), busy: "idle" });
      useBadges.getState().note("chainDays");
      noteTally("SAVE");
      onSaved();
    } catch (e) {
      // a state of another line is never written over a pet (A18), and a refusal says the registry's reason (A19)
      set({ busy: "idle", error: quiet ? null : chainReason(e) });
    }
  },
  enableAuto: async (pet) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      const key = (await sessionAccount()).address;
      const now = Number((await publicClient.getBlock()).timestamp);
      // a little under the contract's 30-day limit, so the block that includes it is never past it
      const until = now + AUTO_DAYS * 86_400 - 600;
      await setSitterOnChain(publicClient, wallet, deployment, BigInt(record.petId), key, BigInt(until));
      const balance = await publicClient.getBalance({ address: key });
      if (balance < AUTO_FUND / 2n) {
        const tx = await wallet.sendTransaction({
          to: key,
          value: AUTO_FUND - balance,
          account: wallet.account!,
          chain,
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }
      store(pet, { ...record, autoUntil: until, sitter: undefined });
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
    }
  },
  endSitting: async (pet) => {
    const record = records[petKey(pet)];
    if (!deployment || !record) return;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      set({ busy: "saving" });
      await setSitterOnChain(
        publicClient,
        wallet,
        deployment,
        BigInt(record.petId),
        "0x0000000000000000000000000000000000000000",
        0n,
      );
      store(pet, { ...record, autoUntil: undefined, sitter: undefined });
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
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
      set({ busy: "idle", error: chainReason(e) });
      return false;
    }
  },
  quoteSelf: async (pet) => {
    if (!deployment || pet.family) return null;
    set({ busy: "connecting", error: null });
    try {
      const wallet = await connectWallet();
      const net = compileProgram(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth));
      const q = await quoteTapeout(
        publicClient,
        deployment.processor,
        wallet.account!.address,
        net.gates.length,
        net.latches.length,
        netlistBytes(net).length,
      );
      set({ busy: "idle" });
      return q;
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
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
      set({ busy: "idle", error: chainReason(e) });
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
            ? await relayChild(await signRelayRequest(signer, "child", record.petId, { card: petCard(plain) }))
            : await relayBrain(
                await signRelayRequest(signer, "brain", record.petId, {
                  line: pet.line,
                  lessons: pet.lessons,
                  ...(pet.instincts ? { instincts: pet.instincts } : {}),
                  skills: ruleSkillIds(pet.growth),
                }),
              );
          if (!r.ok) throw new Error(r.reason);
          ownId = r.brainId;
        }
        brainId = ownId;
        // an owned instinct: a circuit that REFs the pet's own brain and the owned one
        if (pet.outside) {
          const r = await relayInstinct(
            await signRelayRequest(await relaySigner(record.petId), "instinct", record.petId, {
              own: ownId,
              processor: pet.outside.processor,
              id: pet.outside.id,
            }),
          );
          if (!r.ok) throw new Error(r.reason);
          brainId = r.brainId;
        }
      }
      const wallet = await connectWallet();
      set({ busy: "saving" });
      await setBrainOnChain(
        publicClient,
        wallet,
        deployment,
        BigInt(record.petId),
        deployment.processor,
        BigInt(brainId),
      );
      const next = { ...record, brains: { ...(record.brains ?? {}), [key]: brainId }, brainKey: key };
      store(pet, next);
      set({ record: activeRecord(), busy: "idle" });
    } catch (e) {
      set({ busy: "idle", error: chainReason(e) });
    }
  },
  exportLog: (pet) => {
    const record = records[petKey(pet)];
    if (!record) return null;
    // the log exactly as the last checkpoint committed it
    const n = record.logLen ?? 0;
    const segments = logSegments({ ...pet, pendingLog: pet.pendingLog.slice(0, n) })
      .map((s) => ({
        brainId: record.brains?.[mindKey(s.lessons, pet.instincts, s.outside, s.skills)] ?? null,
        words: s.words,
      }))
      .filter((s) => s.words.length > 0);
    return JSON.stringify(diaryBody(record.petId, pet.pendingLog.slice(0, n), segments));
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
