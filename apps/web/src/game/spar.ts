/** The spar record kept on this device: wins and losses against each partner. */

import { create } from "zustand";
import { saveWrite } from "./saveRuntime";

const KEY = "lingxi.spar.v1";
export type Record = { w: number; l: number; d: number };

function load(): { [id: string]: Record } {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { [id: string]: Record }) : {};
  } catch {
    return {};
  }
}

interface SparStore {
  records: { [id: string]: Record };
  /** adds a result; returns true if this was the first win against that partner */
  note: (id: string, outcome: "w" | "l" | "d") => boolean;
}

export const useSpar = create<SparStore>((set, get) => ({
  records: load(),
  note: (id, outcome) => {
    const prev = get().records[id] ?? { w: 0, l: 0, d: 0 };
    const next = { ...get().records, [id]: { ...prev, [outcome]: prev[outcome] + 1 } };
    try {
      saveWrite(KEY, JSON.stringify(next));
    } catch {
      // private mode: the record lasts for this visit
    }
    set({ records: next });
    return outcome === "w" && prev.w === 0;
  },
}));
