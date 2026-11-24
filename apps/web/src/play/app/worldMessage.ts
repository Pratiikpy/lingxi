/**
 * P7: the one message over the world at a time, each shown for as long as it takes to read, a newer one replacing it.
 * A small store of its own, so each feature that has something to say (a birth found on chain, a refused decoration, a
 * world notice, a visit, a spar) shows its message where it lives, and the screen only reads it.
 */
import { create } from "zustand";

export interface WorldMsg {
  id: number | string;
  text: string;
  /** how long it stays, in ms */
  ms: number;
}

export const useWorldMessage = create<{ msg: WorldMsg | null; show: (m: WorldMsg) => void; clear: () => void }>(
  (set) => ({
    msg: null,
    show: (msg) => set({ msg }),
    clear: () => set({ msg: null }),
  }),
);
