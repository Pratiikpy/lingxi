/**
 * The pet's voice (web build): when its circuit makes a new decision, or when the
 * player taps it, the pet says one short line about that decision. The line is
 * written by Lingxi's server from the decision itself, so it never disagrees with
 * the brain. Quiet when there is no server (the on-chain build) or it is busy.
 */

import { create } from "zustand";
import { type Pet, stageOf, visibleMeters } from "@lingxi/game";
import { decidingChips } from "../play/ruleText";
import { decidingPart } from "./store";
import { now as gameNow } from "./gameClock";
import { voiceBody } from "./requests";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
/** At most one new line this often on its own; a tap may ask sooner. */
const AUTO_EVERY_MS = 45_000;
const TAP_EVERY_MS = 8_000;

let available: Promise<boolean> | null = null;
function voiceAvailable(): Promise<boolean> {
  if (!BASE) return Promise.resolve(false);
  available ??= fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.json() as Promise<{ voice?: boolean }>)
    .then((j) => j.voice === true)
    .catch(() => false);
  return available;
}

interface VoiceState {
  line: string | null;
  id: number;
  lastAt: number;
  lastSig: string;
  speak: (pet: Pet, lang: "en" | "zh", tapped?: boolean) => Promise<void>;
  hush: () => void;
}

export const useVoice = create<VoiceState>((set, get) => ({
  line: null,
  id: 0,
  lastAt: 0,
  lastSig: "",
  hush: () => set({ line: null }),
  speak: async (pet, lang, tapped = false) => {
    const stage = stageOf(pet, gameNow());
    if (!(await voiceAvailable())) return;
    const chips = decidingChips(decidingPart(pet).program, pet.last.rule, "en");
    const sig = `${lang}|${chips.then}|${chips.when.join("+")}|${pet.asleep}|${pet.sick}`;
    const now = gameNow();
    const s = get();
    if (now - s.lastAt < (tapped ? TAP_EVERY_MS : AUTO_EVERY_MS)) return;
    if (!tapped && sig === s.lastSig) return;
    set({ lastAt: now, lastSig: sig });
    try {
      const r = await fetch(`${BASE}/api/voice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(voiceBody({ pet, lang, stage, chips, meters: visibleMeters(pet), tapped })),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await r.json()) as { ok: boolean; line?: string };
      if (j.ok && j.line) set((x) => ({ line: j.line!, id: x.id + 1 }));
    } catch {
      // quiet: the pet simply doesn't speak this time
    }
  },
}));
