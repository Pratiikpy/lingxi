// @vitest-environment happy-dom
/**
 * R72: the Pet sheet's "Shops, friends and more" ran about sixteen screens on a phone, twenty panels one after another
 * under three headings, so a player could not find the item shop or their badges. It is now in named parts, listed at
 * its top: a tap on one jumps the sheet to it and puts the focus on its heading, and each part has a way back to the
 * list. Nothing is taken out: every panel is still drawn, in its part.
 */
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { leave, show, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

async function parts(lang: "en" | "zh") {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  const { useLang } = await import("../i18n");
  useLang.setState({ lang });
  const { MoreParts } = await import("./MoreParts");
  const panel = (name: string) => createElement("p", { className: "panel" }, name);
  // the parts as the Pet sheet holds them: inside its own scrolling box
  const view = await show(
    createElement(
      "div",
      { className: "sbody", style: { overflowY: "auto" } },
      createElement(MoreParts, {
        parts: [
          { id: "style", children: [panel("Wardrobe"), panel("Studio")] },
          { id: "shops", children: [panel("Item shop")] },
          { id: "badges", children: [panel("Badges")] },
        ],
      }),
    ),
  );
  const box = document.querySelector<HTMLElement>(".sbody")!;
  const moves: ScrollToOptions[] = [];
  box.scrollTo = ((o: ScrollToOptions) => void moves.push(o)) as typeof box.scrollTo;
  return { view, moves };
}

describe("the Pet sheet's 'more' in parts (R72)", () => {
  it("lists every part at its top, in order, in the player's language", async () => {
    const en = await parts("en");
    const index = Array.from(document.querySelectorAll(".me-parts-index button")).map((b) => b.textContent);
    expect(index).toEqual(["Style", "Shops", "Badges"]);
    const heads = Array.from(document.querySelectorAll(".me-part-h h3")).map((h) => h.textContent);
    expect(heads).toEqual(["Style", "Shops", "Badges"]);
    en.view.unmount();
    const zh = await parts("zh");
    expect(Array.from(document.querySelectorAll(".me-parts-index button")).map((b) => b.textContent)).toEqual([
      "衣橱和造型",
      "商店",
      "徽章",
    ]);
    zh.view.unmount();
  });

  it("keeps every panel drawn, each in its part", async () => {
    const { view } = await parts("en");
    const of = (part: string) =>
      Array.from(document.querySelectorAll(`#me-part-${part} .panel`)).map((p) => p.textContent);
    expect(of("style")).toEqual(["Wardrobe", "Studio"]);
    expect(of("shops")).toEqual(["Item shop"]);
    expect(of("badges")).toEqual(["Badges"]);
    view.unmount();
  });

  it("a tap in the list jumps the sheet to that part and gives its heading the focus; its way back returns", async () => {
    const { view, moves } = await parts("en");
    const shops = Array.from(document.querySelectorAll<HTMLButtonElement>(".me-parts-index button"))[1]!;
    await act(async () => shops.click());
    expect(moves).toHaveLength(1);
    expect(document.activeElement?.closest("#me-part-shops"), "the part's heading has the focus").not.toBeNull();
    const back = document.querySelector<HTMLButtonElement>("#me-part-shops .me-part-back")!;
    expect(back.textContent).toBe("Back to the list");
    await act(async () => back.click());
    expect(moves).toHaveLength(2);
    expect(document.activeElement, "back on the part in the list").toBe(shops);
    view.unmount();
  });
});
