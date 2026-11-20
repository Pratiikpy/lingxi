// @vitest-environment happy-dom
/** A124: a sheet opened from another opens on top of it, as Escape already assumes. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

describe("stacked sheets (A124)", () => {
  it("the sheet opened second is drawn above the first, its scrim too, whatever their order on the page", async () => {
    await visit({ at: Date.UTC(2026, 10, 21, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
    const z = (el: Element | null | undefined) => Number((el as HTMLElement | null)?.style.zIndex || getComputedStyle(el as Element).zIndex || 0);
    const sheet = (title: string) => host.querySelector(`.sheet[aria-label="${title}"]`);
    expect(z(sheet("Skills")), "the skills sheet is on top").toBeGreaterThan(z(sheet("About")));
    const scrims = Array.from(host.querySelectorAll(".scrim")).map(z);
    expect(Math.max(...scrims), "its scrim covers the sheet below").toBeGreaterThan(z(sheet("About")));
    act(() => root.unmount());
    host.remove();
  });
});
