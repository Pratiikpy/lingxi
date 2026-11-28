// @vitest-environment happy-dom
/**
 * R75: a new player's bag showed every sewing and building pattern at once, dimmed, each with its needs in red as
 * "Daffodil ×2 (0) + Old Bottle ×1 (0)" and a dashed Sew it could not use: a wall of things not yet possible. What can be
 * made now comes first, a plain line says what to do when nothing can, and every other pattern waits in a closed fold,
 * the nearest to done first, naming only what the bag already holds towards it.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAKE_RECIPES } from "@lingxi/world";
import { leave, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

async function bag(lang: "en" | "zh", bagItems: Record<number, number> = {}) {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  const { useGame } = await import("../game/store");
  const { useWorld } = await import("../game/world");
  const { useLang } = await import("../i18n");
  const { BagPanel } = await import("./WorldPanels");
  useLang.setState({ lang });
  useGame.getState().hatch("gentle", "Kiko");
  const w = useWorld.getState().world;
  useWorld.setState({ world: { ...w, bag: { ...w.bag, ...bagItems } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(BagPanel, { onFed: () => {} })));
  const make = host.querySelector(".make-patterns")!;
  return { host, make, unmount: () => act(() => root.unmount()) };
}

/** What a player sees of the section without opening anything: its text outside any closed fold. */
const shown = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  for (const d of Array.from(copy.querySelectorAll("details:not([open]) > :not(summary)"))) d.remove();
  return copy.textContent ?? "";
};

describe("the bag's sewing and building patterns (R75)", () => {
  it("a new player sees a plain line and one closed fold, not a wall of '(0)'", async () => {
    const { make, unmount } = await bag("en");
    expect(shown(make)).not.toContain("(0)");
    expect(make.querySelectorAll(":scope > ul > .bag-item")).toHaveLength(0);
    expect(shown(make)).toContain("Nothing to make yet");
    const fold = make.querySelector("details");
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector("summary")?.textContent).toBe(`All patterns (${MAKE_RECIPES.length})`);
    expect(fold?.querySelectorAll(".bag-item")).toHaveLength(MAKE_RECIPES.length);
    // inside, no disabled Sew stands by a pattern that cannot be made
    expect(fold?.querySelectorAll("button:disabled")).toHaveLength(0);
    unmount();
  });

  it("a pattern the bag can make comes first, with its button; the closest of the rest leads the fold", async () => {
    const ready = MAKE_RECIPES[0]!;
    const half = MAKE_RECIPES[1]!;
    const items: Record<number, number> = {};
    for (const x of ready.ins) items[x.item] = (items[x.item] ?? 0) + x.amount;
    items[half.ins[0]!.item] = (items[half.ins[0]!.item] ?? 0) + half.ins[0]!.amount;
    const { make, unmount } = await bag("zh", items);
    const first = make.querySelector(":scope > ul > .bag-item");
    expect(first, "the pattern it can make, out of the fold").not.toBeNull();
    expect(first!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
    expect(shown(make)).not.toContain("还没有能做的");
    const fold = make.querySelector("details")!;
    expect(fold.querySelector("summary")?.textContent).toBe(`更多图样（${MAKE_RECIPES.length - 1}）`);
    // the one half gathered leads the fold, and says what is held towards it
    const lead = fold.querySelector(".bag-item")!;
    expect(lead.textContent).toContain(`${half.ins[0]!.amount}/${half.ins[0]!.amount}`);
    unmount();
  });
});
