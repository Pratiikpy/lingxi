/** D21: the simulator's check fails when a recorded value has drifted from what the simulator measures. */
import { describe, expect, it } from "vitest";
import { staleTargets } from "../src";

describe("a stale recorded simulator value fails the check (D21)", () => {
  it("names every target whose recorded value differs, met or open, leaving a regressed one to its own report", () => {
    const recorded = {
      a: { value: "grinder 127", status: "met" as const },
      b: { value: "4 left", status: "open" as const },
      c: { value: "x", status: "met" as const },
      d: { value: "same", status: "met" as const },
    };
    const now = [
      { id: "a", value: "grinder 122", met: true },
      { id: "b", value: "2 left", met: false },
      { id: "c", value: "y", met: false },
      { id: "d", value: "same", met: true },
    ];
    expect(staleTargets(now, recorded)).toEqual(["a", "b"]);
  });
});
