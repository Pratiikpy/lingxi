// @vitest-environment happy-dom
/**
 * R73: a tab not open yet asks "Not open yet" in a dialog. Escape closed every sheet and the quest dialog but not this
 * one (the review's probe: still open after Escape). It now closes on Escape as on "I'll wait", and the focus goes back
 * to the tab that asked.
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

describe("the locked tab's dialog and Escape (R73)", () => {
  it("Escape closes it as 'I'll wait' does, and the focus is back on the tab", async () => {
    await visit({ at: Date.UTC(2026, 10, 28, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { LockedTab } = await import("./app/RoomPanels");
    const { installModalFocus } = await import("./modalFocus");
    const realRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function () {
      return [{}] as unknown as DOMRectList;
    };
    const opened: string[] = [];
    function Bar() {
      const [ask, setAsk] = useState(false);
      return createElement(
        "div",
        null,
        createElement("button", { type: "button", className: "tab", onClick: () => setAsk(true) }, "Map"),
        ask &&
          createElement(LockedTab, {
            gate: "map",
            petName: "Biscuit",
            onWait: () => setAsk(false),
            onOpenAll: () => opened.push("all"),
          }),
      );
    }
    const stop = installModalFocus();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Bar)));
    const tab = host.querySelector<HTMLButtonElement>(".tab")!;
    tab.focus();
    await act(async () => tab.click());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const dialog = host.querySelector("[role=dialog]");
    expect(dialog, "the dialog asks").not.toBeNull();
    expect(dialog!.contains(document.activeElement), "and has the focus").toBe(true);
    await act(async () =>
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(host.querySelector("[role=dialog]"), "closed by Escape").toBeNull();
    expect(opened, "Escape never opens everything").toEqual([]);
    expect(document.activeElement, "the focus is back on the tab").toBe(tab);
    await act(async () => root.unmount());
    stop();
    Element.prototype.getClientRects = realRects;
  });
});
