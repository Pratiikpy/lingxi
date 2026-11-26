// @vitest-environment happy-dom
/**
 * R8: while the egg cracks, the focus is on the egg and a screen reader is told it is hatching. The Hatch button goes
 * with the form, and the focus used to fall back to the page: NVDA said "document" and nothing of the egg.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => (vi.restoreAllMocks(), leave()));

describe("the egg as it cracks (R8)", () => {
  it("takes the focus from the Hatch button and says, in words, that the pet is on the way", async () => {
    await visit({ at: Date.UTC(2026, 10, 26, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    MotionGlobalConfig.skipAnimations = true;
    // this page's own animations reject when one is cut short by the unmount; without them the game's motion runs in
    // script, where a skipped animation simply ends
    const proto = Element.prototype as { animate?: unknown };
    const animate = proto.animate;
    delete proto.animate;
    // the eggs are drawn on canvases, which this page has none of: a pencil that draws nothing stands in
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
      clearRect: () => {},
      drawImage: () => {},
    } as never);
    const { Hatch } = await import("./Hatch");
    const { useHatchDraft } = await import("./hatchDraft");
    const { takeHatched } = await import("./afterHatch");
    const hatched: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Hatch, { onHatch: (_line, name) => void hatched.push(name) })));
    await act(async () => useHatchDraft.getState().update({ typed: "Kiko" }));
    const go = host.querySelector<HTMLButtonElement>(".hatch-go")!;
    go.focus();
    await act(async () => go.click());
    const stage = host.querySelector<HTMLElement>(".hatch-stage")!;
    expect(stage, "the egg is on screen, cracking").not.toBeNull();
    expect(document.activeElement, "the focus is on the egg, not back on the page").toBe(stage);
    expect(stage.querySelector(".sr-only")?.textContent).toBe("The egg is hatching: Kiko is on the way.");
    // the crack runs its frames, then the pet is handed over and the room is told a pet was just hatched
    await act(async () => void (await vi.advanceTimersByTimeAsync(420 * 5 + 50)));
    expect(hatched).toEqual(["Kiko"]);
    expect(takeHatched()).toBe(true);
    act(() => root.unmount());
    host.remove();
    proto.animate = animate;
    MotionGlobalConfig.skipAnimations = false;
  });
});
