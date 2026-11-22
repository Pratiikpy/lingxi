/**
 * D6: a small habit a resting pet shows now and then, by its strongest habit. Timed by the clock (1.6 seconds in every
 * seven), never chosen at random, and never shown while it sleeps, is ill, is being cared for, or with reduced motion.
 */
import type { Expression } from "@lingxi/art";

export const HABIT_EVERY_MS = 7_000;
export const HABIT_FOR_MS = 1_600;

export interface HabitPose {
  /** a face to show instead of its own */
  expression?: Expression;
  /** pixels to move sideways (a shy pet shrinks back) */
  shift: number;
  /** puff up (1) */
  squash: 0 | 1;
  /** face left (-1) or right (1), for a curious look about */
  face?: -1 | 1;
  /** start a hop now */
  hop: boolean;
}

/** The pose at `now` for a pet resting with this habit, or null when it is not showing one. */
export function habitPose(habit: string | null | undefined, now: number, resting: boolean): HabitPose | null {
  if (!habit || !resting) return null;
  const t = (now % HABIT_EVERY_MS) / HABIT_FOR_MS;
  if (t >= 1) return null;
  switch (habit) {
    case "playful":
      return { shift: 0, squash: 0, hop: t < 0.05 };
    case "shy":
      return { expression: "shy", shift: -Math.round(Math.sin(t * Math.PI) * 5), squash: 0, hop: false };
    case "calm":
      return { expression: "asleep", shift: 0, squash: 0, hop: false };
    case "greedy":
      return { expression: Math.floor((now % HABIT_EVERY_MS) / 200) % 2 ? "munchShut" : "happy", shift: 0, squash: 0, hop: false };
    case "brave":
      return { expression: "sparkly", shift: 0, squash: t > 0.2 && t < 0.8 ? 1 : 0, hop: false };
    case "gentle":
      return { expression: "love", shift: 0, squash: 0, hop: false };
    case "curious":
      return { shift: 0, squash: 0, face: Math.floor(t * 4) % 2 ? -1 : 1, hop: false };
    default:
      return null;
  }
}
