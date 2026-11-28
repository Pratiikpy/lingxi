// @vitest-environment happy-dom
/**
 * R58: a first visit's handover to the full game keeps the keyboard's place. The hatch screen is drawn on its own first
 * and drawn again by the full game once it has loaded (FirstVisit.tsx); the swap replaced every control, so the focus
 * fell to the page and a key pressed then did nothing (CI's keyboard spec, 7888ba4: Space on an instinct switch lost).
 * The place is now kept across the swap, and no swap is made while a key is held down.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

const handedOver: unknown[] = [];
vi.mock("./gameParts", async (actual) => ({
  ...(await actual<typeof import("./gameParts")>()),
  loadGame: () => Promise.resolve({ parts: "the game" }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  handedOver.length = 0;
  document.body.innerHTML = "";
  leave();
});

async function setUp() {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    clearRect: () => {},
    drawImage: () => {},
  } as never);
  const { Hatch } = await import("./Hatch");
  const { keepFocus } = await import("./handoverFocus");
  const mount = async (): Promise<{ host: HTMLElement; root: Root }> => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Hatch, { onHatch: () => {} })));
    return { host, root };
  };
  return { Hatch, keepFocus, mount };
}

describe("the keyboard's place across the handover (R58)", () => {
  it("the switch that had the focus has it again on the screen the full game draws", async () => {
    const { keepFocus, mount } = await setUp();
    const first = await mount();
    const greedy = first.host.querySelectorAll<HTMLButtonElement>(".instinct")[1]!;
    greedy.focus();
    expect(document.activeElement).toBe(greedy);
    keepFocus(first.host.querySelector(".hatch"));
    await act(async () => first.root.unmount());
    first.host.remove();
    const second = await mount();
    const again = second.host.querySelectorAll<HTMLButtonElement>(".instinct")[1]!;
    expect(document.activeElement, "the same switch, on the new screen").toBe(again);
    // and Space there works, as a player would press it
    await act(async () => again.click());
    expect(again.getAttribute("aria-checked")).toBe("true");
  });

  it("the name box gets the focus back with the caret where it was", async () => {
    const { keepFocus, mount } = await setUp();
    const first = await mount();
    const box = first.host.querySelector<HTMLInputElement>("#pet-name")!;
    box.focus();
    box.setSelectionRange(2, 2);
    keepFocus(first.host.querySelector(".hatch"));
    await act(async () => first.root.unmount());
    first.host.remove();
    const second = await mount();
    const again = second.host.querySelector<HTMLInputElement>("#pet-name")!;
    expect(document.activeElement).toBe(again);
    expect([again.selectionStart, again.selectionEnd]).toEqual([2, 2]);
  });

  it("a screen drawn with no place kept takes no focus", async () => {
    const { mount } = await setUp();
    await mount();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the handover waits while a key is held (R58)", () => {
  it("hands over only once the key is up, and keeps the place it hands over from", async () => {
    await setUp();
    const { FirstVisit } = await import("./FirstVisit");
    const { focusKept } = await import("./handoverFocus");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(createElement(FirstVisit, { handOver: (g: unknown) => void handedOver.push(g), onFail: () => {} })),
    );
    host.querySelectorAll<HTMLButtonElement>(".instinct")[0]!.focus();
    // a key goes down (it also starts the game loading), and stays down a while
    // the page's clock is the test's (testGame fakes the timers): a second passes by the clock
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(handedOver, "no swap while the key is held").toHaveLength(0);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(handedOver).toEqual([{ parts: "the game" }]);
    expect(focusKept(), "the switch's place is kept for the full game's screen").toBe(true);
    await act(async () => root.unmount());
  });
});
