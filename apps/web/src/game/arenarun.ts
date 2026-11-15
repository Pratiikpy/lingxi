/**
 * The arena run kept on this device (PRD A2): the run in progress, if any, and
 * the best result so far. A run is saved after every choice, so closing the
 * tab mid-run loses nothing.
 */

import { create } from "zustand";
import { RUN_VERSION, type RunState, type RunStep, startRun } from "@lingxi/game";

const KEY = "lingxi.run.v1";
/** coins for finishing a run with all ten trophies */
export const RUN_WIN_COINS = 40;

interface Saved {
  run: RunState | null;
  best: number;
  won: number;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { run: null, best: 0, won: 0 };
    const s = JSON.parse(raw) as Saved;
    return { run: s.run && s.run.version === RUN_VERSION ? s.run : null, best: s.best ?? 0, won: s.won ?? 0 };
  } catch {
    return { run: null, best: 0, won: 0 };
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode: the run lasts for this visit
  }
}

interface RunStore extends Saved {
  begin: () => void;
  /** apply a shop or line step; returns the refusal reason, if any */
  step: (r: RunStep) => string | null;
  put: (run: RunState) => void;
  /** a run reached its end: record the best and count a won run */
  finish: (run: RunState, won: boolean) => void;
  abandon: () => void;
}

export const useRun = create<RunStore>((set, get) => {
  const keep = (patch: Partial<Saved>) => {
    const next = { run: get().run, best: get().best, won: get().won, ...patch };
    save(next);
    set(next);
  };
  return {
    ...load(),
    begin: () => keep({ run: startRun(crypto.getRandomValues(new Uint32Array(1))[0]!) }),
    step: (r) => {
      if (!r.ok) return r.why;
      keep({ run: r.state });
      return null;
    },
    put: (run) => keep({ run }),
    finish: (run, won) => keep({ run, best: Math.max(get().best, run.trophies), won: get().won + (won ? 1 : 0) }),
    abandon: () => keep({ run: null }),
  };
});
