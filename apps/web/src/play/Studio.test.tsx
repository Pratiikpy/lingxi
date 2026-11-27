// @vitest-environment happy-dom
/**
 * The design studio's publish terms (H8): a creator chooses the coin, and each coin says where its fee goes.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

async function openStudio(lang: "en" | "zh" = "en") {
  await visit({ at: Date.UTC(2026, 10, 22, 9) });
  // the pet preview paints a canvas, which this test does not look at: a 2D context that draws nothing
  const ctx = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    clearRect: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    imageSmoothingEnabled: false,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  const { useGame } = await import("../game/store");
  const { StudioPanel } = await import("./Studio");
  useGame.getState().hatch("gentle", "Kiri");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(StudioPanel, { pet: useGame.getState().pet! })));
  const radios = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".studio-coin [role=radio]"));
  const terms = () => host.querySelector(".studio-publish")!.textContent ?? "";
  return { host, radios, terms, close: () => (act(() => root.unmount()), host.remove()) };
}

describe("publishing a design (H8)", () => {
  it("offers BEM and OKB, BEM first, each saying where the 3% goes", async () => {
    const s = await openStudio();
    expect(s.radios().map((r) => r.textContent)).toEqual(["BEM", "OKB"]);
    expect(s.radios()[0]!.getAttribute("aria-checked")).toBe("true");
    expect(s.terms()).toContain("Price per copy (BEM)");
    expect(s.terms()).toMatch(/3% of every sale is burned/);
    await act(async () => s.radios()[1]!.click());
    expect(s.radios()[1]!.getAttribute("aria-checked")).toBe("true");
    expect(s.terms()).toContain("Price per copy (OKB)");
    expect(s.terms()).toMatch(/3% of every sale goes to the project, which keeps the game running/);
    expect(s.terms()).not.toMatch(/burned/);
    // a price nobody typed follows the coin: 0.1 OKB is far more than 0.1 BEM
    const price = () => (s.host.querySelector(".studio-terms input") as HTMLInputElement).value;
    expect(price()).toBe("0.001");
    await act(async () => s.radios()[0]!.click());
    expect(price()).toBe("0.1");
    s.close();
  });

  it("says the same in Chinese", async () => {
    const s = await openStudio("zh");
    expect(s.terms()).toContain("每份价格（BEM）");
    expect(s.terms()).toMatch(/销毁/);
    await act(async () => s.radios()[1]!.click());
    expect(s.terms()).toContain("每份价格（OKB）");
    expect(s.terms()).toMatch(/归项目所有/);
    s.close();
  });
});

describe("the studio's colours (R36, R40)", () => {
  /** sets a colour input as a player's picker does, through the setter React watches */
  const pick = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const inkColour = (host: HTMLElement, k: number) =>
    host.querySelectorAll<HTMLElement>(".studio-ink:not(.erase) > span")[k - 1]?.style.background;
  const inks = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLInputElement>(".studio-ink > input"));
  /** which of the inks (1 to 3) is chosen, or 0 for Erase */
  const chosen = (host: HTMLElement) => {
    const i = inks(host).findIndex((r) => r.checked);
    return i === 3 ? 0 : i + 1;
  };
  const swatch = (host: HTMLElement, name: string) =>
    host.querySelector<HTMLButtonElement>(`.studio-swatch[aria-label='${name}']`);

  it("has one well for a colour of the player's own, which colours the chosen ink", async () => {
    const s = await openStudio();
    const wells = s.host.querySelectorAll<HTMLInputElement>("input[type=color]");
    expect(wells.length, "one well, beside the swatches, not one on each ink's corner").toBe(1);
    const well = wells[0]!;
    expect(well.closest(".studio-swatches"), "it sits with the swatches").not.toBeNull();
    expect(well.getAttribute("aria-label")).toBe("Your own colour, now deep plum");
    const before = inkColour(s.host, 1);
    // the second ink chosen, then a colour of the player's own
    const second = inks(s.host)[1]!;
    await act(async () => second.click());
    expect(second.getAttribute("aria-label")).toBe("Colour 2: coral");
    expect(well.value, "the well shows the chosen ink's colour").toBe("#e8604a");
    expect(well.getAttribute("aria-label")).toBe("Your own colour, now coral");
    await act(async () => pick(well, "#00a0ff"));
    expect(inkColour(s.host, 2), "the second ink takes it").toMatch(/#00a0ff|rgb\(0, 160, 255\)/);
    expect(inkColour(s.host, 1), "the first is as it was").toBe(before);
    expect(second.getAttribute("aria-label"), "named by the nearest colour, never its hex").toBe(
      "Colour 2: close to azure",
    );
    // a swatch colours the chosen ink too
    await act(async () => swatch(s.host, "Mint green")?.click());
    expect(inkColour(s.host, 2)).toMatch(/#7fcb8e|rgb\(127, 203, 142\)/);
    expect(second.getAttribute("aria-label")).toBe("Colour 2: mint green");
    s.close();
  });

  it("names every swatch and ink by its colour in the player's language, never by a hex code (R40)", async () => {
    for (const [lang, names, first, erase] of [
      ["en", ["Deep plum", "White", "Coral", "Pink", "Sunny yellow"], "Colour 1: deep plum", "Erase"],
      ["zh", ["深紫", "白色", "珊瑚红", "粉红", "明黄"], "颜色 1：深紫", "擦除"],
    ] as const) {
      const s = await openStudio(lang);
      const labels = Array.from(s.host.querySelectorAll(".studio-swatch")).map((b) => b.getAttribute("aria-label"));
      expect(labels).toHaveLength(12);
      expect(labels.slice(0, 5)).toEqual(names);
      for (const l of labels) expect(l, "a colour word, not a code").not.toMatch(/#|[0-9a-f]{6}/i);
      expect(inks(s.host)[0]!.getAttribute("aria-label")).toBe(first);
      expect(inks(s.host)[3]!.closest("label")?.textContent).toBe(erase);
      s.close();
      leave();
    }
  });

  it("a swatch tapped while erasing turns Erase off and colours the ink chosen before it (R40)", async () => {
    const s = await openStudio();
    await act(async () => inks(s.host)[1]!.click());
    await act(async () => inks(s.host)[3]!.click());
    expect(chosen(s.host), "erasing").toBe(0);
    await act(async () => swatch(s.host, "Sky blue")?.click());
    expect(chosen(s.host), "drawing again, with the ink chosen before Erase").toBe(2);
    expect(inkColour(s.host, 2), "and that ink has the colour").toMatch(/#7fb7f0|rgb\(127, 183, 240\)/);
    expect(inkColour(s.host, 1), "the others are as they were").toMatch(/#2b2140|rgb\(43, 33, 64\)/);
    expect(inkColour(s.host, 3)).toMatch(/#ffc83d|rgb\(255, 200, 61\)/);
    s.close();
  });

  it("the well works while erasing too: it shows the ink chosen before, and a colour from it turns Erase off (R40)", async () => {
    const s = await openStudio("zh");
    const well = s.host.querySelector<HTMLInputElement>("input[type=color]")!;
    expect(well.getAttribute("aria-label")).toBe("自己调颜色，现在是深紫");
    await act(async () => inks(s.host)[2]!.click());
    await act(async () => inks(s.host)[3]!.click());
    expect(chosen(s.host), "erasing").toBe(0);
    expect(well.disabled, "nothing a player can do is taken away while erasing").toBe(false);
    expect(well.value, "it shows the ink that was chosen before Erase").toBe("#ffc83d");
    expect(well.getAttribute("aria-label")).toBe("自己调颜色，现在是明黄");
    await act(async () => pick(well, "#ff0000"));
    expect(chosen(s.host), "drawing again with that ink").toBe(3);
    expect(inkColour(s.host, 3)).toMatch(/#ff0000|rgb\(255, 0, 0\)/);
    expect(inks(s.host)[2]!.getAttribute("aria-label")).toBe("颜色 3：接近红色");
    s.close();
  });

  it("drawing on the grid after a swatch ended Erase draws in that colour, not erases (R40)", async () => {
    const s = await openStudio();
    const cell = (x: number, y: number) =>
      s.host.querySelector<HTMLButtonElement>(`.studio-cell[aria-label='${x},${y}']`)!;
    await act(async () => cell(1, 1).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(cell(1, 1).style.background, "drawn with the first ink").toMatch(/#2b2140|rgb\(43, 33, 64\)/);
    await act(async () => inks(s.host)[3]!.click());
    await act(async () => swatch(s.host, "Coral")?.click());
    await act(async () => cell(2, 1).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(cell(2, 1).style.background, "the next stroke is ink, in coral").toMatch(/#e8604a|rgb\(232, 96, 74\)/);
    expect(cell(1, 1).style.background, "the first ink took coral too, as a swatch always recolours its ink").toMatch(
      /#e8604a|rgb\(232, 96, 74\)/,
    );
    s.close();
  });
});
