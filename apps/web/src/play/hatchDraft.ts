/**
 * What the player has chosen on the hatch screen so far (P3): the egg, the name drawn or typed, the instincts, and
 * whether the egg is cracking. It lives outside the screen so a first visit's standalone hatch screen (FirstVisit.tsx)
 * can hand over to the full game, which mounts the same screen again, without losing a choice. Whoever receives the
 * hatched pet clears it once the pet exists, so the next egg starts fresh.
 */
import type { StarterLine } from "@lingxi/brain";
import type { Instinct } from "@lingxi/game";
import { create } from "zustand";

export interface HatchDraft {
  line: StarterLine;
  /** which of the circuit's suggested names is shown */
  draw: number;
  /** the player's own name, once they type one */
  typed: string | null;
  instincts: Instinct[];
  /** the crack frame showing, -1 before the egg is tapped */
  cracking: number;
}

const FRESH: HatchDraft = { line: "gentle", draw: 0, typed: null, instincts: [], cracking: -1 };

export const useHatchDraft = create<HatchDraft & { update: (part: Partial<HatchDraft>) => void; reset: () => void }>(
  (set) => ({
    ...FRESH,
    update: (part) => set(part),
    reset: () => set(FRESH),
  }),
);
