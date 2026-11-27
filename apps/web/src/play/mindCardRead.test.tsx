// @vitest-environment happy-dom
/**
 * R52: the knowledge card in the room is read on Tab. It is a scrolling region the keyboard reaches; NVDA in focus mode
 * (where it is after the hatch and the care buttons) speaks a focused region's name, role and description, so the card
 * said only its name until the player switched modes (R38). The region is now described by its own lists of rules, so
 * the rules are what is said on the Tab, as spoken sentences (the chips are hidden from a screen reader), in either mode.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

/** The text a screen reader takes from an element: its text, without what is hidden from it. */
const spoken = (el: Element): string => {
  const copy = el.cloneNode(true) as Element;
  for (const h of Array.from(copy.querySelectorAll("[aria-hidden=true]"))) h.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
};

async function roomCard(lang: "en" | "zh") {
  await visit({ at: Date.UTC(2026, 10, 27, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useGame } = await import("../game/store");
  const { useLang } = await import("../i18n");
  const { CareColumn } = await import("./app/RoomPanels");
  useLang.setState({ lang });
  useGame.getState().hatch("gentle", "Kiri");
  const pet = useGame.getState().pet!;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(CareColumn, { pet, lang, talking: false, thinking: pet, taught: false, pick: () => {} })),
  );
  const region = host.querySelector("[role=region][aria-labelledby=mindcard-h]");
  return { region, host, unmount: () => act(async () => root.unmount()) };
}

describe("the knowledge card is read on Tab (R52)", () => {
  for (const lang of ["en", "zh"] as const) {
    it(`${lang}: the card's region is described by its rules, each a spoken sentence`, async () => {
      const { region, host, unmount } = await roomCard(lang);
      expect(region, "the card is a region the keyboard reaches").not.toBeNull();
      expect(region!.getAttribute("tabindex")).toBe("0");
      const ids = (region!.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      expect(ids.length, "described by its lists of rules").toBeGreaterThan(0);
      const lists = ids.map((id) => host.querySelector(`#${id}`));
      expect(
        lists.every((l) => l?.tagName === "UL" && l.classList.contains("rules")),
        "each id is a list of rules",
      ).toBe(true);
      const description = lists.map((l) => spoken(l!)).join(" ");
      const rules = host.querySelectorAll(".rules li").length;
      expect(rules).toBeGreaterThan(3);
      // every rule is said as its sentence: "…, then …." in English, "…，就…。" in Chinese
      expect(description.split(lang === "zh" ? "就" : ", then ").length - 1).toBe(rules);
      // and the first rule is said first, as the list shows it
      expect(description.startsWith(spoken(host.querySelector(".rules li")!))).toBe(true);
      await unmount();
    });
  }

  it("ids are the room card's own, so the mind sheet open over the room repeats none", async () => {
    const { host, unmount } = await roomCard("en");
    const { MindPanel } = await import("./Sheets");
    const { useGame } = await import("../game/store");
    const sheet = document.createElement("div");
    document.body.append(sheet);
    const r = createRoot(sheet);
    await act(async () => r.render(createElement(MindPanel, { pet: useGame.getState().pet! })));
    const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
    expect(new Set(ids).size, "no id twice on the page").toBe(ids.length);
    expect(host.querySelectorAll(".rules[id]").length).toBeGreaterThan(0);
    await act(async () => r.unmount());
    await unmount();
  });
});
