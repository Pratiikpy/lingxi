import { describe, expect, it } from "vitest";
import { PRESS_MS, showSteps } from "./patternShow";

const GAP = 560;
/** What the pads show at time `t` of the showing. */
const litAt = (steps: ReturnType<typeof showSteps>, t: number) => {
  let lit: number | null = -1;
  for (const s of steps) if (s.at <= t) lit = s.lit;
  return lit;
};

describe("the pattern game's showing (A9)", () => {
  it("first puts out the press that ended the last round", () => {
    const steps = showSteps([2], GAP);
    expect(steps[0]).toEqual({ at: PRESS_MS, lit: null });
  });

  it("shows nothing for a clear pause, at least one light's time, before the first light", () => {
    const steps = showSteps([1, 3], GAP);
    const first = steps.find((s) => s.lit !== null)!;
    expect(first.lit).toBe(1);
    expect(first.at - PRESS_MS).toBeGreaterThanOrEqual(GAP / 2);
    for (let t = PRESS_MS; t < first.at; t += 10) expect(litAt(steps, t)).toBeNull();
  });

  it("lights each pad in order for half a step, with dark between, so the same pad twice is seen twice", () => {
    const steps = showSteps([0, 0, 3], GAP);
    const lights = steps.filter((s) => s.lit !== null);
    expect(lights.map((s) => s.lit)).toEqual([0, 0, 3]);
    for (const l of lights) {
      expect(litAt(steps, l.at + GAP / 2 - 1)).toBe(l.lit);
      expect(litAt(steps, l.at + GAP / 2)).toBeNull();
    }
  });

  it("ends dark: the player's turn begins after the last light is out", () => {
    const steps = showSteps([2, 1, 0], GAP);
    expect(steps.at(-1)!.lit).toBeNull();
    expect(steps.at(-1)!.at).toBeGreaterThan(steps.filter((s) => s.lit !== null).at(-1)!.at);
  });

  it("keeps its order of time", () => {
    const steps = showSteps([3, 1, 2, 0, 1], 700);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.at).toBeGreaterThan(steps[i - 1]!.at);
  });
});
