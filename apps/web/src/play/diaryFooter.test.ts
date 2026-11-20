/** A92: the line on a shared diary image says what holds for that pet. */
import { describe, expect, it } from "vitest";
import { diaryFooter } from "./diaryFooter";

describe("the shared diary image's footer (A92)", () => {
  it("a pet kept on X Layer: its mind is taped out there and its saved days can be checked", () => {
    expect(diaryFooter(true, "en")).toBe("Lingxi · its mind is taped out on X Layer, and its saved days can be checked there");
    expect(diaryFooter(true, "zh")).toBe("灵犀 · 它的心智流片在 X Layer 上，存档的每一天都能在链上验证");
  });

  it("a pet not kept there is not said to be checkable on X Layer", () => {
    for (const lang of ["en", "zh"] as const) expect(diaryFooter(false, lang)).not.toMatch(/X Layer/);
    expect(diaryFooter(false, "en")).toBe("Lingxi · a pet whose mind is a circuit you can read");
  });
});
