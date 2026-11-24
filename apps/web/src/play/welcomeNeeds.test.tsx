// @vitest-environment happy-dom
/** G5: the welcome-back card says how the pet's needs held up while the player was away, plainly and never as blame. */
import { describe, expect, it } from "vitest";
import { needsText } from "./Welcome";

const m = (food: number, joy = 900, energy = 900, clean = 900) => ({
  food: food * 60,
  joy: joy * 60,
  energy: energy * 60,
  clean: clean * 60,
});

describe("how the needs held up while away (G5)", () => {
  it("says the needs waited at their lowest, naming each one, in English and Chinese", () => {
    const p = { name: "Pip", meters: m(240, 240), sick: false, hibernating: false };
    expect(needsText(p, "en")).toBe("Its needs waited for you at their lowest: it is hungry and a little low now.");
    expect(needsText(p, "zh")).toBe("它的需求停在最低处等你回来：现在饿了、有点闷。");
  });

  it("tells the illness of real neglect and the long sleep, each with what to do", () => {
    expect(needsText({ name: "Pip", meters: m(100), sick: true, hibernating: false }, "en")).toBe(
      "After days without care, Pip fell ill. Medicine makes it well.",
    );
    expect(needsText({ name: "Pip", meters: m(0), sick: true, hibernating: true }, "en")).toBe(
      "Pip's food ran out and it fell into a long sleep. Feed it or give it a pat to wake it.",
    );
    expect(needsText({ name: "Pip", meters: m(800), sick: false, hibernating: false }, "zh")).toBe(
      "它的需求都还好好的。",
    );
  });
});
