/**
 * The timing of "Follow the Pattern"'s showing (A9). A round is shown as a timeline the game plays from the moment
 * the round begins: the press that ended the last round goes out, the pads stay dark for a clear pause, then each pad
 * is lit for half a step with dark between. The showing owns every light while it plays, so the player's last press
 * can neither run into the first light (the same pad) nor, on a slow phone whose timers run late, switch it off.
 */

/** How long a press lights its pad. */
export const PRESS_MS = 180;

export interface ShowStep {
  /** ms from the round's start */
  at: number;
  /** the pad lit from then on, or none */
  lit: number | null;
}

/** The steps of one showing of `seq`, `gap` ms per light; the player's turn begins after the last. */
export function showSteps(seq: readonly number[], gap: number): ShowStep[] {
  const steps: ShowStep[] = [{ at: PRESS_MS, lit: null }];
  // a pause of one full step, all dark, before the first light
  const start = PRESS_MS + gap;
  seq.forEach((pad, i) => {
    steps.push({ at: start + i * gap, lit: pad }, { at: start + i * gap + gap / 2, lit: null });
  });
  return steps;
}
