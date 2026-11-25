/**
 * Where each pet's X Layer record lives on this device (P7: out of chain.ts): the records themselves, hatches sent
 * but not yet confirmed (A30), births waiting to be finished, and the breeding consents this device has given. Each
 * is kept in this browser's storage and survives a reload; an unreadable store reads as empty rather than crashing.
 */
import { type Address, type Hex } from "viem";
import { type Pet } from "@lingxi/game";
import { useGame, whenKeptOnChain } from "./store";
import { saveWrite } from "./saveRuntime";

export const OLD_KEY = "lingxi.chain.v1";
export const CHAIN_KEY = "lingxi.chain.v2";
export const LINES = ["gentle", "bold", "curious"] as const;

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

export function loadRecords(): Record<string, ChainRecord> {
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

export let records = loadRecords();
export function store(pet: Pet, rec: ChainRecord | null): void {
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
export const PENDING_KEY = "lingxi.chain.pending.v1";
/** A hatch the node has never heard of is let go after this long (it was dropped, or never left the wallet). */
export const PENDING_FORGET_MS = 30 * 60_000;
export interface PendingHatch {
  tx: Hex;
  owner: string;
  at: number;
  /** how many words the log held, and the memory, when the hatch's state was taken (A66); absent on older entries */
  n?: number;
  memory?: number[];
}
export function loadPending(): Record<string, PendingHatch> {
  try {
    const r = localStorage.getItem(PENDING_KEY);
    return r ? (JSON.parse(r) as Record<string, PendingHatch>) : {};
  } catch {
    return {};
  }
}
export let pending = loadPending();
export function setPending(pet: Pet, p: PendingHatch | null): void {
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
export const BIRTHS_KEY = "lingxi.chain.births.v1";
export interface PendingBirth {
  tx: Hex;
  owner: string;
  at: number;
  brainId: string;
  child: Pet;
}
export function loadBirths(): Record<string, PendingBirth> {
  try {
    const r = localStorage.getItem(BIRTHS_KEY);
    return r ? (JSON.parse(r) as Record<string, PendingBirth>) : {};
  } catch {
    return {};
  }
}
export let births = loadBirths();
export function setBirth(parentKey: string, b: PendingBirth | null): void {
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
export const CONSENTS_KEY = "lingxi.chain.consents.v1";
/** A breeding consent standing on X Layer: the breeder it is on and the wallet it lets raise one little one. */
export interface GivenConsent {
  breeder: Address;
  partner: Address;
}
export function loadGiven(): Record<string, GivenConsent[]> {
  try {
    const r = localStorage.getItem(CONSENTS_KEY);
    return r ? (JSON.parse(r) as Record<string, GivenConsent[]>) : {};
  } catch {
    return {};
  }
}
export let given = loadGiven();
export function setGiven(key: string, list: GivenConsent[]): void {
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
export const sameConsent = (a: GivenConsent, b: GivenConsent) =>
  a.breeder.toLowerCase() === b.breeder.toLowerCase() && a.partner.toLowerCase() === b.partner.toLowerCase();

/** Any pet's chain record on this device, and setting it (pet-sitting moves records between devices). */
export const recordOf = (pet: Pick<Pet, "bornAt">): ChainRecord | null => records[petKey(pet)] ?? null;
// the store cuts only the logs of pets not kept here (A148)
whenKeptOnChain((p) => recordOf(p) !== null);
/** Every wallet that owns a pet kept on this device (community goals count what these wallets did on chain). */
export const deviceWallets = (): string[] =>
  [...new Set(Object.values(records).map((r) => r.owner.toLowerCase()))]
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w))
    .slice(0, 8);

export const activeRecord = () => {
  const p = useGame.getState().pet;
  return p ? (records[petKey(p)] ?? null) : null;
};
