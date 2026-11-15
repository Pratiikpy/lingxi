/**
 * When will the pet next need you? Runs the game forward on its own rules (the
 * same catch-up a returning player sees) and returns the first moment each need
 * appears, so a reminder can arrive before it turns into a care mistake.
 */

import { toVisible } from "./pet";
import { catchUp, type Brain, type Pet } from "./sim";

export type NeedKind = "hungry" | "bored" | "dirty" | "sick";

export interface Need {
  kind: NeedKind;
  /** when it first appears (ms) */
  at: number;
}

/** Visible-unit levels (0..1000) at which a need is worth a reminder: low, not yet empty. */
export const NEED_AT = { hungry: 200, bored: 150, dirty: 150 } as const;
/** How far ahead to look. A day and a half covers a night's sleep and a busy day. */
export const HORIZON_MS = 36 * 3_600_000;
const STEP_MS = 20 * 60_000;

function needsOf(p: Pet): NeedKind[] {
  const out: NeedKind[] = [];
  if (toVisible(p.meters.food) < NEED_AT.hungry) out.push("hungry");
  if (toVisible(p.meters.joy) < NEED_AT.bored) out.push("bored");
  if (toVisible(p.meters.clean) < NEED_AT.dirty) out.push("dirty");
  if (p.sick) out.push("sick");
  return out;
}

/**
 * The first time each need appears within the horizon, earliest first. A need
 * the pet already has is reported at `now`.
 */
export function upcomingNeeds(pet: Pet, now: number, brain: Brain, horizonMs = HORIZON_MS): Need[] {
  const found = new Map<NeedKind, number>();
  for (const k of needsOf(catchUp(pet, now, brain))) found.set(k, now);
  let p = catchUp(pet, now, brain);
  for (let t = now + STEP_MS; t <= now + horizonMs && found.size < 4; t += STEP_MS) {
    p = catchUp(p, t, brain);
    for (const k of needsOf(p)) if (!found.has(k)) found.set(k, t);
  }
  return [...found].map(([kind, at]) => ({ kind, at })).sort((a, b) => a.at - b.at);
}
