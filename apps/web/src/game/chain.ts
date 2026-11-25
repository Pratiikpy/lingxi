/**
 * Keeping a pet on X Layer from the browser: connect a wallet, hatch the pet's
 * on-chain twin with its starter brain, and write daily checkpoints.
 *
 * Wallets: an injected wallet (OKX Wallet first, then any EIP-1193 provider).
 * In local development against a fork only, a throwaway test key can stand in
 * (VITE_DEV_KEY); it is never part of a production build.
 */
import { create } from "zustand";
import { type TapeQuote, type TapeStep } from "@lingxi/chain";
import { type Pet } from "@lingxi/game";
import type { ChainInfo } from "./live";
import { useGame } from "./store";
import { type ChainRecord, petKey, records, store, type GivenConsent, activeRecord } from "./chainRecords";
import { familyActions } from "./chainFamily";
import { keepActions } from "./chainKeep";
import { mindActions } from "./chainMind";
import { saveActions } from "./chainSave";

export {
  type ChainRecord,
  autoStatus,
  mindKey,
  chainDay,
  petKey,
  type GivenConsent,
  recordOf,
  deviceWallets,
} from "./chainRecords";
export { connectWallet, signSeasonEntry, autoGasLow } from "./chainHelpers";
export { API_RPC, NETWORK, OFFICIAL_RPCS, deployment, explorerTx, publicClient, rpcs, walletAddress } from "./network";

export function setRecordOf(pet: Pet, rec: ChainRecord | null): void {
  store(pet, rec);
  useChain.setState({ record: activeRecord() });
}

export interface ChainState {
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

export const useChain = create<ChainState>((set, get) => ({
  record: activeRecord(),
  freeOn: null,
  recordOf: (pet) => records[petKey(pet)] ?? null,
  busy: "idle",
  error: null,
  forget: () => {
    const p = useGame.getState().pet;
    if (p) store(p, null);
    set({ record: null });
  },
  ...keepActions(set, get),
  ...familyActions(set),
  ...saveActions(set, get),
  ...mindActions(set),
}));

// the record on screen follows the pet on screen
useGame.subscribe((s, prev) => {
  if (s.pet?.bornAt !== prev.pet?.bornAt) useChain.setState({ record: activeRecord() });
});
