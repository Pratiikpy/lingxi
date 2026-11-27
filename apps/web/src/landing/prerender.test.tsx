// @vitest-environment node
/**
 * R53: the landing as the build draws it marks the visitor's time of day before its code arrives. The build cannot know
 * the hour, so the page it drew marked Day and flipped to Dusk or Night when its code came; the script the build writes
 * in after the page now marks the right one at once, by the same hours as the page's code (phaseAt).
 */
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PHASES, phaseAt } from "./heroPhase";

let mod: { render: (lang: "en" | "zh") => string; phaseScript: () => string };

beforeAll(async () => {
  // rendered with no document, as the build renders it
  mod = await import("./prerender");
});
afterEach(() => {
  vi.useRealTimers();
});

/** The page as the build writes it: both languages' copies, then the first script, run at `hour`. */
const firstPaintAt = (hour: number) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, hour, 30));
  const { document } = new Window();
  document.body.innerHTML = `<div id="root"><div data-prerender="en">${mod.render("en")}</div><div data-prerender="zh" hidden>${mod.render("zh")}</div></div>`;
  new Function("document", mod.phaseScript())(document);
  return [...document.querySelectorAll("#root .l-phase [role=radio]")] as unknown as HTMLElement[];
};
const checked = (radios: HTMLElement[]) =>
  radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);

describe("the landing's first paint shows the visitor's time of day (R53)", () => {
  it("marks Night at night, Dusk in the evening and Day in the day, in both copies", () => {
    expect(checked(firstPaintAt(23))).toEqual(["Night", "夜晚"]);
    expect(checked(firstPaintAt(3))).toEqual(["Night", "夜晚"]);
    expect(checked(firstPaintAt(18))).toEqual(["Dusk", "黄昏"]);
    expect(checked(firstPaintAt(9))).toEqual(["Day", "白天"]);
    expect(checked(firstPaintAt(14))).toEqual(["Day", "白天"]);
  });

  it("agrees with the page's own code at every hour", () => {
    for (let h = 0; h < 24; h++) {
      const radios = firstPaintAt(h);
      const want = PHASES.indexOf(phaseAt(h));
      expect(
        radios.map((r) => r.getAttribute("aria-checked")),
        `hour ${h}`,
      ).toEqual(radios.map((_, i) => String(i % PHASES.length === want)));
    }
  });
});
