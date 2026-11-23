/**
 * Each starter line's colours and the growth stages a pet is drawn at: what the game's screens need to draw a pet with
 * the canvas sprites, kept apart from the scene's PIXI textures (textures.ts) so that a screen showing a pet does not
 * pull the scene engine into the game's start-up (P3).
 */
import { CORAL, type Palette, SKY, SUNNY } from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";

export const PALETTE_OF: Record<StarterLine, Palette> = { gentle: CORAL, bold: SUNNY, curious: SKY };

export type PetStage = "baby" | "child" | "teen" | "adult";
