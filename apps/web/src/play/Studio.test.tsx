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
  const ctx = { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined, clearRect: () => undefined, drawImage: () => undefined, fillRect: () => undefined, imageSmoothingEnabled: false };
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
