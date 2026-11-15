/**
 * Interface sound effects for clicks, chirps and successes (the music is in
 * music.ts). Sound starts off and turns on with one tap (browsers
 * only play audio after the visitor interacts); the choice is remembered.
 */

import { create } from "zustand";

const KEY = "lingxi.sound";
const FX = {
  tap: "pet/sound/fx/interaction/click2.mp3",
  pop: "pet/sound/fx/interaction/click.mp3",
  chirp0: "pet/sound/fx/pet/pet0.mp3",
  chirp1: "pet/sound/fx/pet/pet1.mp3",
  chirp2: "pet/sound/fx/pet/pet2.mp3",
  chirp3: "pet/sound/fx/pet/pet3.mp3",
  success: "pet/sound/fx/interaction/success.mp3",
  sparkle: "pet/sound/fx/interaction/scribble.mp3",
  hatch: "pet/sound/fx/interaction/wonderegg.mp3",
  error: "pet/sound/fx/interaction/error.mp3",
  bell: "pet/sound/fx/interaction/bell.mp3",
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
