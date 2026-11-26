// @vitest-environment happy-dom
/**
 * R8: after hatching, the focus comes to the pet. NVDA said only "document" once the Hatch button had gone with its
 * screen; with the focus on the pet's button its next words are the pet: "Pat Kiko, button, Kiko, baby: ...".
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

describe("the moment after hatching (R8)", () => {
  it("the pet's button takes the focus in the first room after a hatching, and only then", async () => {
    await visit({ at: Date.UTC(2026, 10, 26, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // the room measures itself; nothing here depends on its size
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
    };
    const { useGame } = await import("../game/store");
    const { markHatched, takeHatched } = await import("./afterHatch");
    const { PetButton, FOCUS_AFTER_HATCH_MS } = await import("./PetButton");
    // the page's clock is the test's (testGame.ts): the moment is stepped through
    const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(FOCUS_AFTER_HATCH_MS + 100)));
    useGame.getState().hatch("gentle", "Kiko");
    const pet = useGame.getState().pet!;
    const room = () => createElement(PetButton, { pet, stage: "baby" as const, onPat: () => {} });
    const host = document.createElement("div");
    document.body.append(host);

    // a room opened on a pet that was already there (a returning player): the focus is left where it was
    expect(takeHatched(), "nothing was hatched on this page yet").toBe(false);
    let root = createRoot(host);
    await act(async () => root.render(room()));
    await settle();
    expect(document.activeElement?.className ?? "").not.toContain("pet-button");
    act(() => root.unmount());

    // the room that follows a hatching: the focus is on the pet, named and described
    markHatched();
    root = createRoot(host);
    await act(async () => root.render(room()));
    // not in the same breath as the button is made: a screen reader misses a focus moved that soon
    expect(document.activeElement?.className ?? "").not.toContain("pet-button");
    await settle();
    const at = document.activeElement as HTMLElement;
    expect(at.className).toContain("pet-button");
    expect(at.getAttribute("aria-label")).toBe("Pat Kiko");
    expect(document.getElementById(at.getAttribute("aria-describedby")!)?.textContent).toContain("Kiko, baby");
    expect(takeHatched(), "the mark is taken once").toBe(false);
    act(() => root.unmount());
    host.remove();
  });
});
