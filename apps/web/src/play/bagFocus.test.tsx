// @vitest-environment happy-dom
/**
 * R37: the bag keeps the keyboard's place. Its rows were a component made inside the bag's own render, so each render
 * (the game's clock, a coin, anything in the world) made a new kind of row and React rebuilt every one: the button a
 * keyboard player had tabbed to was thrown away and the focus fell to the page. Enter then went nowhere; the browser
 * suite's keyboard spec saw it as a feed that did not land, now and then (P7g, R37).
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

describe("the bag keeps the keyboard's place (R37)", () => {
  it("a button the focus is on is the same button after the bag renders again", async () => {
    await visit({ at: Date.UTC(2026, 10, 27, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    MotionGlobalConfig.skipAnimations = true;
    const { useGame } = await import("../game/store");
    const { useWorld } = await import("../game/world");
    const { BagPanel } = await import("./WorldPanels");
    useGame.getState().hatch("gentle", "Kiko");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(BagPanel, { onFed: () => {} })));
    const feed = host.querySelector<HTMLButtonElement>(".bag-item .btn");
    expect(feed, "the bag has a food to feed").not.toBeNull();
    feed?.focus();
    expect(document.activeElement).toBe(feed);
    // the world changes under the open bag, as the game's clock and its rewards change it
    await act(async () => {
      const w = useWorld.getState().world;
      useWorld.setState({ world: { ...w, coins: w.coins + 5 } });
    });
    expect(host.querySelector(".bag-item .btn"), "the row is still the same element").toBe(feed);
    expect(document.activeElement, "and the focus is still on it").toBe(feed);
    act(() => root.unmount());
    host.remove();
    MotionGlobalConfig.skipAnimations = false;
  });
});
