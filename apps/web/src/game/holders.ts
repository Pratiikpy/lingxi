/**
 * Holder cosmetics (PRD X2): what a connected wallet holds on X Layer, read from
 * the tokens' own contracts, and the purely cosmetic things it unlocks. A TapeOut
 * Rig gives the home a rig-bay skin; BEM and FAB each give a holder mark; a
 * TapeCode Test1 NFT gives a gilded egg shell. Nothing here changes how a pet
 * thinks, fights or earns.
 */

import { create } from "zustand";
import { type Address, parseAbi } from "viem";
import type { SnapshotFile } from "@lingxi/chain";
import { deployment, publicClient } from "./network";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";

/** The contracts on X Layer (chain 196), as TapeOut's and Fab X's own sites configure them. */
export const HOLDINGS = {
  /** TapeOut Rig, ERC-721 (tapeout.net's `rigVoucher` for X Layer) */
  rig: "0x9cfc959cd42B2e1d39a0d850c528210E818AE520",
  /** BEM, 8 decimals */
  bem: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952",
  /** FAB, Fab X's Proof-of-Design mining token, 8 decimals (fabx.tech's pod mining `token()`) */
  fab: "0x72F349B1Eee7833B26f8C81a8410775A4e231ed2",
  /** TapeCode-Test1 (TCT1), ERC-721, 10,000 tokens; the address OKX's NFT market lists for the collection, read back on chain */
  test1: "0x0e91460d6823c711643e650a9a4c0cc21de41614",
} as const;

const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface Holdings {
  wallet: string;
  rig: boolean;
  bem: boolean;
  fab: boolean;
  test1: boolean;
  /** held at least one minimum of BEM or FAB at the gift's snapshot block (C3); absent when it could not be read */
  snapshot?: boolean;
  /** this wallet has already claimed its holder pin (C3); absent when it could not be read */
  pinClaimed?: boolean;
  at: number;
}

/** Read the wallet's balances; any amount above zero counts. */
export async function readHoldings(wallet: Address): Promise<Holdings> {
  const bal = async (token: string) =>
    ((await publicClient.readContract({
      address: token as Address,
      abi: balanceAbi,
      functionName: "balanceOf",
      args: [wallet],
    })) as bigint) > 0n;
  const [rig, bem, fab, test1] = await Promise.all([
    bal(HOLDINGS.rig),
    bal(HOLDINGS.bem),
    bal(HOLDINGS.fab),
    bal(HOLDINGS.test1),
  ]);
  return { wallet: wallet.toLowerCase(), rig, bem, fab, test1, at: now() };
}

/**
 * The holder pin's standing for this wallet (C3), read as the claim panel reads it: whether the wallet is in the BEM and
 * FAB snapshot that ships with the site (checked against the gift contract's root), and whether it has claimed already.
 * Either is left out when it cannot be read, so the screen never promises or refuses on a guess.
 */
export async function readPinStatus(wallet: Address): Promise<{ snapshot?: boolean; pinClaimed?: boolean }> {
  if (!deployment?.holderGift) return {};
  try {
    // P3: the gift's code (with the Merkle-tree library) is fetched only when a wallet's pin is read, not with the game
    const { giftClaimed, giftTerms, loadSnapshot, snapshotWay } = await import("@lingxi/chain/holderGift");
    const t = await giftTerms(publicClient, deployment);
    if (!t) return {};
    const claimed = await giftClaimed(publicClient, t, wallet).catch(() => undefined);
    let snapshot: boolean | undefined;
    try {
      const file = (await (await fetch(new URL("holder-snapshot.json", document.baseURI))).json()) as SnapshotFile;
      snapshot = snapshotWay(loadSnapshot(file, t), t, wallet) !== null;
    } catch {
      snapshot = undefined;
    }
    return {
      ...(snapshot !== undefined ? { snapshot } : {}),
      ...(claimed !== undefined ? { pinClaimed: claimed } : {}),
    };
  } catch {
    return {};
  }
}

const KEY = "lingxi.holdings.v1";

interface HoldingsStore {
  held: Holdings | null;
  /** the rig-bay home skin, switched on by default for rig holders */
  skinOn: boolean;
  set: (h: Holdings) => void;
  setSkin: (on: boolean) => void;
  clear: () => void;
}

function load(): { held: Holdings | null; skinOn: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { held?: Holdings; skinOn?: boolean } | null;
    return { held: v?.held ?? null, skinOn: v?.skinOn ?? true };
  } catch {
    return { held: null, skinOn: true };
  }
}

export const useHoldings = create<HoldingsStore>((set, get) => {
  const keep = (next: { held: Holdings | null; skinOn: boolean }) => {
    try {
      saveWrite(KEY, JSON.stringify(next));
    } catch {
      // private mode: lasts for this visit
    }
    set(next);
  };
  return {
    ...load(),
    set: (h) => keep({ held: h, skinOn: get().skinOn }),
    setSkin: (on) => keep({ held: get().held, skinOn: on }),
    clear: () => keep({ held: null, skinOn: get().skinOn }),
  };
});

/** The rig-bay home: TapeOut's guardhouse room, which no place in the world uses. */
export const RIG_HOME_BGS = {
  day: "art/rooms/27_guardhouse/backgrounds/playtest.png",
  evening: "art/rooms/27_guardhouse/backgrounds/playtest.png",
  night: "art/rooms/27_guardhouse/backgrounds/playtest.png",
} as const;
