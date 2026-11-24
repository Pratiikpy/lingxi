// @vitest-environment happy-dom
/**
 * P3a: the Decorate bar leaves the room in view. With no piece in hand it shows one shelf at a time (the pieces, or the
 * Builder's commissions); once a piece is picked it folds into one strip naming the piece, so the room below is free to
 * tap. On a phone the full bar, both shelves stacked, once covered the whole room and nothing could be placed.
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

async function open(lang: "en" | "zh") {
  await visit({ at: Date.UTC(2026, 10, 23, 9) });
  // the test page has no canvas to draw on: the icons draw into a stand-in
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillStyle: "",
  })) as never);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  const { useGame } = await import("../game/store");
  useGame.getState().hatch("gentle", "Pip");
  const { DecorBar } = await import("./DecorBar");
  const picks: Array<string | null> = [];
  let done = 0;
  // the bar as the game holds it: the piece in hand lives above it
  function Host() {
    const [held, setHeld] = useState<string | null>(null);
    return createElement(DecorBar, {
      selected: held,
      onSelect: (id: string | null) => (picks.push(id), setHeld(id)),
      onDone: () => done++,
    });
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Host)));
  const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
  const tabs = () => Array.from(host.querySelectorAll('[role="tab"]'));
  return { host, picks, done: () => done, click, tabs, close: () => (act(() => root.unmount()), host.remove()) };
}

describe("the Decorate bar leaves the room in view (P3a)", () => {
  for (const [lang, w] of [
    [
      "en",
      {
        pieces: "Pieces",
        commissions: "Builder's commissions",
        placing: "Placing: ",
        change: "Change",
        count: "0 of 12 placed",
        tap: "Tap the room where it goes.",
      },
    ],
    [
      "zh",
      {
        pieces: "摆件",
        commissions: "建设者的委托",
        placing: "正在摆放：",
        change: "换一件",
        count: "已摆 0/12 件",
        tap: "点房间里要放的位置。",
      },
    ],
  ] as const) {
    it(`shows one shelf at a time, and the count beside the coins (${lang})`, async () => {
      const s = await open(lang);
      expect(s.tabs().map((t) => t.textContent)).toEqual([w.pieces, w.commissions]);
      expect(s.tabs()[0]!.getAttribute("aria-selected")).toBe("true");
      expect(s.host.querySelector(".decor-count")?.textContent).toBe(w.count);
      expect(s.host.querySelectorAll(".decor-list .decor-piece").length).toBeGreaterThan(3);
      expect(s.host.querySelector(".decor-commissions"), "the commissions wait on their own shelf").toBeNull();
      await s.click(s.tabs()[1]);
      expect(s.tabs()[1]!.getAttribute("aria-selected")).toBe("true");
      expect(s.host.querySelector(".decor-commissions"), "the commissions shelf is shown").not.toBeNull();
      expect(s.host.querySelectorAll(".decor-commissions .decor-piece").length).toBeGreaterThan(0);
      s.close();
    });

    it(`folds into one strip with a piece in hand, and Change opens the shelves again (${lang})`, async () => {
      const s = await open(lang);
      // a new player owns no pieces and has 30 coins: tapping one it can afford buys it and puts it in hand
      const affordable = Array.from(s.host.querySelectorAll(".decor-list .decor-piece.shop")).find(
        (b) => Number(b.querySelector("small")?.textContent?.match(/\d+/)?.[0]) <= 30,
      )!;
      const name = affordable.querySelector("span")!.textContent!;
      await s.click(affordable);
      expect(s.picks).toEqual([expect.any(String)]);
      const bar = s.host.querySelector(".decor-bar")!;
      expect(bar.classList.contains("placing")).toBe(true);
      expect(bar.querySelector("b")?.textContent).toBe(`${w.placing}${name}`);
      expect(bar.querySelector(".decor-hint")?.textContent).toBe(w.tap);
      expect(bar.querySelector(".decor-count")?.textContent, "the count stays in view").toBe(w.count);
      expect(bar.querySelectorAll(".decor-piece").length, "no shelf while a piece is in hand").toBe(0);
      expect(s.tabs()).toHaveLength(0);
      await s.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === w.change));
      expect(s.picks.at(-1)).toBeNull();
      expect(s.host.querySelector(".decor-bar")!.classList.contains("placing")).toBe(false);
      expect(s.tabs()).toHaveLength(2);
      await s.click(s.host.querySelector(".decor-head .btn.primary"));
      expect(s.done()).toBe(1);
      s.close();
    });
  }
});
