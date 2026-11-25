/**
 * Two things a conversation with a resident does on its own (P7: out of Talk): the gift a resident hands over on its
 * village gift day (D2), and each line typed out from its start, standing written in full with reduced motion.
 */
import { useEffect, useState } from "react";
import { useWorld } from "../game/world";

/** On a gift day, the resident whose day it is hands over a little something; null on any other. */
export function useVillageGift(whoId: string): number | null {
  const [villageGift, setVillageGift] = useState<number | null>(null);
  useEffect(() => {
    // taking the gift is a change to the world (once a day); what was taken is shown once that has settled
    const item = useWorld.getState().villageGift(whoId);
    let live = true;
    void Promise.resolve().then(() => live && setVillageGift(item));
    return () => {
      live = false;
    };
  }, [whoId]);
  return villageGift;
}

/** How much of `text` is written so far, and `skip` to write it out in full at once. */
export function useTypedLine(text: string, lang: string, reduce: boolean): { shown: number; skip: () => void } {
  const [typed, setTyped] = useState(0);
  // each new line is typed out from its start; with reduced motion it stands written in full
  const [typedFor, setTypedFor] = useState(text);
  if (text !== typedFor) {
    setTypedFor(text);
    setTyped(0);
  }
  const shown = reduce ? text.length : typed;
  useEffect(() => {
    if (reduce || typed >= text.length) return;
    const id = setTimeout(() => setTyped((n) => Math.min(text.length, n + (lang === "zh" ? 1 : 2))), 24);
    return () => clearTimeout(id);
  }, [typed, text, lang, reduce]);
  return { shown, skip: () => setTyped(text.length) };
}
