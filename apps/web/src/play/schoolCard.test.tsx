// @vitest-environment happy-dom
/**
 * R60: tapping a Pet School level answers where the player is looking. Its lesson card ("This lesson is… / Teach this")
 * is drawn a screen and a half below the levels, under the sandbox, so the tap changed nothing on screen and the level
 * button the focus was on went disabled under it. The card is now brought into view inside the sheet's own scrolling
 * box (never the page behind) and takes the focus; with reduced motion the box jumps there instead of gliding.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

/** Where things are drawn: the sheet's box a phone screen tall, the lesson card far below its fold. */
const BOX = { top: 120, bottom: 720, height: 600 };
const CARD = { top: 1500, bottom: 1820, height: 320 };

async function school(reduce: boolean) {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    clearRect: () => {},
    drawImage: () => {},
  } as never);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const at = this.classList.contains("sbody") ? BOX : this.classList.contains("proposal") ? CARD : null;
    const r = at ?? { top: 0, bottom: 0, height: 0 };
    return { ...r, left: 0, right: 360, width: 360, x: 0, y: r.top, toJSON: () => r } as DOMRect;
  });
  const { useGame } = await import("../game/store");
  const { TeachPanel } = await import("./Teach");
  useGame.getState().hatch("bold", "Biscuit");
  const host = document.createElement("div");
  host.className = "sbody";
  host.style.overflowY = "auto";
  document.body.append(host);
  const scrolled: ScrollToOptions[] = [];
  host.scrollTo = ((o: ScrollToOptions) => void scrolled.push(o)) as typeof host.scrollTo;
  const pageScrolled = vi.fn();
  window.scrollTo = pageScrolled as never;
  const root = createRoot(host);
  await act(async () => root.render(createElement(TeachPanel, { pet: useGame.getState().pet! })));
  return { host, scrolled, pageScrolled, unmount: () => act(async () => root.unmount()) };
}

describe("a Pet School level answers in view (R60)", () => {
  it("its lesson card is scrolled into the sheet's view and takes the focus", async () => {
    const { host, scrolled, pageScrolled, unmount } = await school(false);
    const level = host.querySelector<HTMLButtonElement>(".level-head[data-hint=teach]");
    expect(level, "level 1 is open to teach").not.toBeNull();
    level!.focus();
    await act(async () => level!.click());
    const card = host.querySelector<HTMLElement>(".proposal");
    expect(card, "the lesson card is drawn").not.toBeNull();
    expect(card!.textContent).toContain("Teach this");
    // the sheet's own box moves so the whole card shows, its foot a little above the box's
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.top).toBe(CARD.bottom - BOX.bottom + 16);
    expect(scrolled[0]!.behavior).toBe("smooth");
    expect(pageScrolled, "the page behind the sheet stays where it is").not.toHaveBeenCalled();
    // the focus is on the card (the level it left is disabled now), and the card says what it is
    expect(document.activeElement).toBe(card);
    const label = document.getElementById(card!.getAttribute("aria-labelledby") ?? "");
    expect(label?.textContent).toContain("This lesson is");
    await unmount();
  });

  it("with reduced motion the box jumps to the card instead of gliding", async () => {
    const { host, scrolled, unmount } = await school(true);
    await act(async () => host.querySelector<HTMLButtonElement>(".level-head[data-hint=teach]")!.click());
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.behavior).toBe("instant");
    expect(document.activeElement).toBe(host.querySelector(".proposal"));
    await unmount();
  });

  it("a card already in view is not moved, and still takes the focus", async () => {
    const { host, scrolled, unmount } = await school(false);
    CARD.top = 300;
    CARD.bottom = 620;
    try {
      await act(async () => host.querySelector<HTMLButtonElement>(".level-head[data-hint=teach]")!.click());
      expect(scrolled).toHaveLength(0);
      expect(document.activeElement).toBe(host.querySelector(".proposal"));
    } finally {
      CARD.top = 1500;
      CARD.bottom = 1820;
    }
    await unmount();
  });
});
