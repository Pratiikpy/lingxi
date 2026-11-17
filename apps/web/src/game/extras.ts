/**
 * Paid extras (plan 4.9) in the browser: the room and look packs the player's wallets hold, read from X Layer on
 * start and after a purchase; the name colours of pets the game shows; and linking a wallet to the player's home so
 * visitors see what it holds (a signature, never a transaction).
 */

import { create } from "zustand";
import type { WalletClient } from "viem";
import { buyPack, colourName, nameColours, packsHeld, readExtras, type ExtrasTerms } from "@lingxi/chain";
import { NAME_COLOUR_BY_ID, homeLinkMessage, syncExtras } from "@lingxi/world";
import { chainWallets } from "./chainDecor";
import { deployment, publicClient } from "./chain";
import { playerId, useLive } from "./live";
import { useWorld } from "./world";

interface ExtrasState {
  /** prices and the colours on offer, as last read */
  terms: ExtrasTerms | null;
  /** name colour by on-chain pet id, as last read (0 = plain) */
  colours: Record<string, number>;
}

export const useExtras = create<ExtrasState>(() => ({ terms: null, colours: {} }));

export const extrasLive = (): boolean => !!deployment?.extras;

/** Read the packs the wallets hold (the most any one holds) and give them to the world. Keeps the last reading on failure. */
export async function syncPacks(extra?: string | null): Promise<boolean> {
  if (!deployment?.extras) return false;
  const wallets = chainWallets(extra);
  try {
    const [packs, terms] = await Promise.all([packsHeld(publicClient, deployment, wallets), readExtras(publicClient, deployment, "0x000000000000000000000000000000000000dEaD")]);
    useExtras.setState({ terms: { ...terms, room: packs.room, looks: packs.looks } });
    const w = useWorld.getState().world;
    const next = syncExtras(w, packs);
    if (next !== w) useWorld.getState().setWorld(next);
    return true;
  } catch {
    return false;
  }
}

/** Read the name colours of these pets (ids on X Layer). */
export async function loadColours(petIds: readonly string[]): Promise<void> {
  if (!deployment?.extras) return;
  const ids = [...new Set(petIds.filter((x) => /^\d{1,20}$/.test(x) && x !== "0"))].slice(0, 200);
  if (!ids.length) return;
  try {
    const got = await nameColours(publicClient, deployment, ids.map((x) => BigInt(x)));
    useExtras.setState((s) => ({ colours: { ...s.colours, ...got } }));
  } catch {
    // the names stay plain until the next reading
  }
}

/** The colour pair a pet's name shows in, or null for plain. */
export function colourFor(colour: number | undefined): { light: string; dark: string } | null {
  const c = colour ? NAME_COLOUR_BY_ID[colour] : undefined;
  return c ? { light: c.light, dark: c.dark } : null;
}

export async function buyRoomOrLooks(wallet: WalletClient, kind: "room" | "looks", price: bigint): Promise<string> {
  const tx = await buyPack(publicClient, wallet, deployment!, kind, price);
  await syncPacks(wallet.account!.address);
  return tx;
}

export async function setNameColour(wallet: WalletClient, petId: string, colour: number, price: bigint): Promise<string> {
  const tx = await colourName(publicClient, wallet, deployment!, BigInt(petId), colour, price);
  useExtras.setState((s) => ({ colours: { ...s.colours, [petId]: colour } }));
  // so friends in the same room see the new colour without waiting for the server's next reading
  useLive.getState().recolour();
  return tx;
}

/** Ask the wallet to sign the link message, send it, and wait for the server's answer. */
export async function linkWallet(wallet: WalletClient): Promise<{ ok: boolean; reason?: string }> {
  const account = wallet.account!;
  const signature = await wallet.signMessage({ account, message: homeLinkMessage(playerId()) });
  const before = useLive.getState().linkAnswer?.at ?? 0;
  useLive.getState().link(account.address, signature);
  return waitForAnswer(before);
}

export function unlinkWallet(address: string): Promise<{ ok: boolean; reason?: string }> {
  const before = useLive.getState().linkAnswer?.at ?? 0;
  useLive.getState().unlink(address);
  return waitForAnswer(before);
}

function waitForAnswer(before: number): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const stop = useLive.subscribe((s) => {
      if (s.linkAnswer && s.linkAnswer.at > before) {
        stop();
        clearTimeout(timer);
        resolve({ ok: s.linkAnswer.ok, ...(s.linkAnswer.reason ? { reason: s.linkAnswer.reason } : {}) });
      }
    });
    const timer = setTimeout(() => (stop(), resolve({ ok: false, reason: "noAnswer" })), 15_000);
  });
}
