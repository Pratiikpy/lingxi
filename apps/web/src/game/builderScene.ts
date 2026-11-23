/**
 * The room residents as the scene draws them, and which of them the player has met: kept apart from their card
 * (play/Builders.tsx) so that drawing a resident in the room does not load the card's chain reads with the game (P3).
 */
import { create } from "zustand";
import { MARS, MINT, type Outfit, type Palette, SILICON, SKY, SUNNY } from "@lingxi/art";
import { BUILDER_PETS, type BuilderId, type BuilderPet, behemothAt, behemothStepNow, builderNow } from "@lingxi/game";
import { useBadges } from "./badges";
import { now as gameNow } from "./gameClock";
import { saveWrite } from "./saveRuntime";

export const PALETTES: Record<BuilderPet["look"]["palette"], Palette> = { silicon: SILICON, mars: MARS, sky: SKY, sunny: SUNNY, mint: MINT };
const KEY = "lingxi.builders.v1";

/** What a resident wears right now: Behemoth's lamps follow its CPU. */
export function builderOutfit(b: BuilderPet, ms: number): Outfit {
  return b.mind.kind === "cpu" ? { head: `b:lamps${behemothAt(behemothStepNow(ms)).acc}` } : b.look.outfit;
}

/** The resident of a room as the scene draws it. */
export function builderInScene(b: BuilderPet, lang: "en" | "zh", saidAt: number) {
  // its line and mood come from its own circuit (plan 4.11)
  const now = builderNow(b, gameNow(), new Date(gameNow()).getHours(), useBuilders.getState().met.includes(b.id));
  return {
    id: `builder:${b.id}`,
    name: b.name[lang],
    line: b.look.line,
    stage: b.look.stage,
    mood: now.mood,
    say: { text: now.line[lang], at: saidAt },
    look: { palette: { key: b.look.palette, colors: PALETTES[b.look.palette] }, outfitAt: (ms: number) => builderOutfit(b, ms), x: b.spot.x, lit: b.mind.kind === "cpu" },
  };
}

function loadMet(): BuilderId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v.filter((x) => BUILDER_PETS.some((b) => b.id === x)) as BuilderId[]) : [];
  } catch {
    return [];
  }
}

export const useBuilders = create<{ met: BuilderId[]; meet: (id: BuilderId) => void }>((set, get) => ({
  met: loadMet(),
  meet: (id) => {
    if (get().met.includes(id)) return;
    const met = [...get().met, id];
    try {
      saveWrite(KEY, JSON.stringify(met));
    } catch {
      // kept for this visit
    }
    set({ met });
    useBadges.getState().note("builders", met.length);
  },
}));
