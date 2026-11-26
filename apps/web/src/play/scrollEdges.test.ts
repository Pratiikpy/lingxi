import { describe, expect, it } from "vitest";
import { moreOf } from "./scrollEdges";

describe("moreOf: which edges of a scrolled box hide more", () => {
  it("says nothing when everything fits", () => {
    expect(moreOf(0, 300, 300)).toBe("none");
    expect(moreOf(0, 300, 200)).toBe("none");
  });

  it("says below at the top of a longer list", () => {
    expect(moreOf(0, 300, 600)).toBe("below");
  });

  it("says both part way down", () => {
    expect(moreOf(120, 300, 600)).toBe("both");
  });

  it("says above at the end", () => {
    expect(moreOf(300, 300, 600)).toBe("above");
  });

  it("treats a pixel or less as the edge, as a zoomed page scrolls in fractions", () => {
    expect(moreOf(0.6, 300, 600)).toBe("below");
    expect(moreOf(299.4, 300, 600)).toBe("above");
  });
});
