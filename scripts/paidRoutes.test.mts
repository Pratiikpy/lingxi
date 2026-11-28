/** R75: the screen inventory blocks the paid routes itself (the review had to run a copy that did). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPaid } from "./paidRoutes.mts";

describe("the paid routes (R75)", () => {
  it("names every route that spends, and none that only reads", () => {
    for (const u of [
      "https://lingxi.knole.me/api/voice",
      "https://lingxi.knole.me/api/teach",
      "https://lingxi.knole.me/api/teach?x=1",
      "https://lingxi.knole.me/api/tapeout",
      "https://lingxi.knole.me/api/tapeout-child",
      "https://lingxi.knole.me/api/tapeout-instinct",
      "https://lingxi.knole.me/api/sponsor",
      "https://lingxi.knole.me/api/sponsor/of/0xabc",
      "/api/voice",
    ])
      expect(isPaid(u), u).toBe(true);
    for (const u of [
      "https://lingxi.knole.me/api/goals",
      "https://lingxi.knole.me/api/lessons",
      "https://lingxi.knole.me/api/numbers",
      "https://lingxi.knole.me/api/time",
      "https://lingxi.knole.me/api/teacher",
      "https://lingxi.knole.me/assets/teach-abc.js",
      "https://lingxi.knole.me/play.html?voice=1",
    ])
      expect(isPaid(u), u).toBe(false);
  });

  it("the screen inventory routes them to nothing in every context it opens", () => {
    const src = readFileSync(join(import.meta.dirname, "screen-inventory.mts"), "utf8");
    expect(src).toMatch(/import \{[^}]*isPaid[^}]*\} from "\.\/paidRoutes\.mts"/);
    expect(src).toMatch(/ctx\.route\(\s*\(url\) => isPaid\(url\.href\)/);
  });
});
