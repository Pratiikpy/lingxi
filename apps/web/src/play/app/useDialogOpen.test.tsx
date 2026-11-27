// @vitest-environment happy-dom
/**
 * R36: while a dialog lies over the room (a quest's lines, a gift, a proposal), the game knows it, so the pet's
 * passing words wait for it to close, as they wait for a sheet.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useDialogOpen } from "./useDialogOpen";

function Probe() {
  return createElement("output", null, useDialogOpen() ? "dialog" : "room");
}

describe("a dialog over the room (R36)", () => {
  it("is seen as it opens and as it closes, wherever on the page it is drawn", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    const said = () => host.querySelector("output")?.textContent;
    expect(said(), "with nothing open").toBe("room");
    // a dialog drawn deep inside another part of the page, as the quest dialog is
    const elsewhere = document.createElement("section");
    document.body.append(elsewhere);
    const modal = document.createElement("div");
    modal.className = "fam-modal";
    await act(async () => elsewhere.append(modal));
    expect(said(), "with a dialog open").toBe("dialog");
    await act(async () => modal.remove());
    expect(said(), "once it has closed").toBe("room");
    act(() => root.unmount());
    host.remove();
    elsewhere.remove();
  });

  it("is open from the first render when the dialog was there before the room", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const modal = document.createElement("div");
    modal.className = "fam-modal";
    document.body.append(modal);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    expect(host.querySelector("output")?.textContent).toBe("dialog");
    act(() => root.unmount());
    host.remove();
    modal.remove();
  });
});
