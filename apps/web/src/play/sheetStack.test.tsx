// @vitest-environment happy-dom
/** A124: a sheet opened from another opens on top of it, as Escape already assumes. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

describe("stacked sheets (A124)", () => {
  it("the sheet opened second is drawn above the first, its scrim too, whatever their order on the page", async () => {
    await visit({ at: Date.UTC(2026, 10, 21, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // the sheets' slide is not what is tested, and an animation cut short by the unmount would be reported as an error
    MotionGlobalConfig.skipAnimations = true;
    const { Sheet } = await import("./Sheets");
    // the skills sheet comes first on the page and the pet's sheet after it, as in the game
    const page = (skills: boolean) =>
      createElement(
        "div",
        null,
        createElement(Sheet, { open: skills, title: "Skills", onClose: () => {}, children: "skills" }),
        createElement(Sheet, { open: true, title: "About", onClose: () => {}, children: "about" }),
      );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    // the pet's sheet is open; the skills sheet is opened from it
    await act(async () => root.render(page(false)));
    await act(async () => root.render(page(true)));
    const z = (el: Element | null | undefined) =>
      Number((el as HTMLElement | null)?.style.zIndex || getComputedStyle(el as Element).zIndex || 0);
    const sheet = (title: string) => host.querySelector(`.sheet[aria-label="${title}"]`);
    expect(z(sheet("Skills")), "the skills sheet is on top").toBeGreaterThan(z(sheet("About")));
    const scrims = Array.from(host.querySelectorAll(".scrim")).map(z);
    expect(Math.max(...scrims), "its scrim covers the sheet below").toBeGreaterThan(z(sheet("About")));
    act(() => root.unmount());
    host.remove();
    MotionGlobalConfig.skipAnimations = false;
  });

  it("takes the focus once, when it opens: a new onClose from its parent does not throw the player back to Close (R8)", async () => {
    await visit({ at: Date.UTC(2026, 10, 26, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    MotionGlobalConfig.skipAnimations = true;
    const { Sheet } = await import("./Sheets");
    let closed = 0;
    // each render hands the sheet a new onClose, as a parent's inline arrow does
    const page = () =>
      createElement(Sheet, {
        open: true,
        title: "Bag",
        onClose: () => void closed++,
        children: createElement("button", { type: "button", className: "inner" }, "Feed"),
      });
    const host = document.createElement("div");
    document.body.append(host);
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const root = createRoot(host);
    await act(async () => root.render(page()));
    expect((document.activeElement as HTMLElement).getAttribute("aria-label"), "the sheet takes the focus").toBe(
      "Close",
    );
    const inner = host.querySelector<HTMLButtonElement>(".inner")!;
    inner.focus();
    await act(async () => root.render(page()));
    expect(document.activeElement, "a re-render leaves the focus where the player put it").toBe(inner);
    // Escape still closes with the latest onClose
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(closed).toBe(1);
    act(() => root.unmount());
    expect(document.activeElement, "and the focus goes back to what opened it").toBe(opener);
    host.remove();
    opener.remove();
    MotionGlobalConfig.skipAnimations = false;
  });
});
