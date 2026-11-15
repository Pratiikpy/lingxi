/**
 * Interface sound effects for clicks, chirps and successes (the music is in
 * music.ts). Sound starts off and turns on with one tap (browsers
 * only play audio after the visitor interacts); the choice is remembered.
 */

import { telegramHaptic } from "./telegram";
import { create } from "zustand";

const KEY = "lingxi.sound";
const FX = {
  tap: "art/sound/fx/interaction/click2.mp3",
  pop: "art/sound/fx/interaction/click.mp3",
  chirp0: "art/sound/fx/pet/chirp0.mp3",
  chirp1: "art/sound/fx/pet/chirp1.mp3",
  chirp2: "art/sound/fx/pet/chirp2.mp3",
  chirp3: "art/sound/fx/pet/chirp3.mp3",
  success: "art/sound/fx/interaction/success.mp3",
  sparkle: "art/sound/fx/interaction/scribble.mp3",
  hatch: "art/sound/fx/interaction/wonderegg.mp3",
  error: "art/sound/fx/interaction/error.mp3",
  bell: "art/sound/fx/interaction/bell.mp3",
} as const;
export type Fx = keyof typeof FX;

const pool = new Map<Fx, HTMLAudioElement>();

function readPref(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

interface SoundState {
  on: boolean;
  toggle: () => void;
}

export const useSound = create<SoundState>((set, get) => ({
  on: readPref(),
  toggle: () => {
    const on = !get().on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // still applies for this visit
    }
    set({ on });
    if (on) play("bell");
  },
}));

export function play(fx: Fx, volume = 0.5): void {
  telegramHaptic(fx);
  if (!useSound.getState().on) return;
  let a = pool.get(fx);
  if (!a) {
    a = new Audio(FX[fx]);
    a.preload = "auto";
    pool.set(fx, a);
  }
  const node = a.cloneNode(true) as HTMLAudioElement;
  node.volume = volume;
  node.play().catch(() => {
    // blocked or missing: sound is decoration, never an error
  });
}

export function chirp(): void {
  play((["chirp0", "chirp1", "chirp2", "chirp3"] as const)[Math.floor(Math.random() * 4)]!, 0.45);
}
