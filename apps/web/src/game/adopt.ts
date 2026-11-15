/**
 * Outside brains a pet has adopted (PRD Z7): a TapeFly brawl brain or a circuit
 * on X Layer becomes the pet's fighting instinct in practice spars, with its
 * author credited. Kept on this device per pet; the pet's own mind, the one that
 * is checkpointed on chain, never changes. Seasons, the daily challenge and duel
 * links always use the pet's own mind, so anyone can replay them.
 */

import { create } from "zustand";
import type { Address } from "viem";
import { type OutsideCircuit, AdoptError, readOutsideCircuit } from "@lingxi/chain";
import { publicClient } from "./chain";
import { type Adopted, type Profile, profileOf } from "./adoptBrain";

export * from "./adoptBrain";

const KEY = "lingxi.adopted.v1";

export type ReadResult = { ok: true; circuit: OutsideCircuit; profile: Profile } | { ok: false; reason: "notProcessor" | "noCircuit" | "tooDeep" | "tooBig" | "illFormed" | "pins" | "offline" };

/** Read a circuit on X Layer and check that its pins fit a fight. */
export async function readCircuit(processor: string, id: string): Promise<ReadResult> {
  if (!publicClient) return { ok: false, reason: "offline" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(processor) || !/^\d{1,12}$/.test(id)) return { ok: false, reason: "noCircuit" };
  try {
    const circuit = await readOutsideCircuit(publicClient as never, processor as Address, BigInt(id));
    const profile = profileOf(circuit.nIn, circuit.nOut);
    return profile ? { ok: true, circuit, profile } : { ok: false, reason: "pins" };
  } catch (e) {
    return { ok: false, reason: e instanceof AdoptError ? e.reason : "offline" };
  }
}

interface AdoptStore {
  byPet: Record<string, Adopted>;
  adopt: (petBornAt: number, a: Omit<Adopted, "on" | "at">) => void;
  setOn: (petBornAt: number, on: boolean) => void;
  drop: (petBornAt: number) => void;
}

function load(): Record<string, Adopted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Adopted>;
  } catch {
    return {};
  }
}

export const useAdopted = create<AdoptStore>((set, get) => {
  const keep = (byPet: Record<string, Adopted>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(byPet));
    } catch {
      // private mode: lasts for this visit
    }
    set({ byPet });
  };
  return {
    byPet: load(),
    adopt: (pet, a) => keep({ ...get().byPet, [String(pet)]: { ...a, on: true, at: Date.now() } }),
    setOn: (pet, on) => {
      const a = get().byPet[String(pet)];
      if (a) keep({ ...get().byPet, [String(pet)]: { ...a, on } });
    },
    drop: (pet) => {
      const { [String(pet)]: _gone, ...rest } = get().byPet;
      keep(rest);
    },
  };
});
