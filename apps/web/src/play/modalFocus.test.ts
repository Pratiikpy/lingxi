// @vitest-environment happy-dom
/**
 * P5: a dialog takes the keyboard's focus when it opens, keeps Tab among its own controls (the one on top, when two are
 * open), and gives the focus back when it closes. R73: Escape closes the dialog on top by its own way out, as Back does.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installModalFocus, topModal, trapTab } from "./modalFocus";

// the test page has no layout: every element counts as drawn
const real = Element.prototype.getClientRects;
beforeEach(() => {
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});
afterEach(() => {
  Element.prototype.getClientRects = real;
  document.body.innerHTML = "";
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const press = (shiftKey = false) => {
  const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(e);
  return e;
};

describe("the game's dialogs and the keyboard (P5)", () => {
  it("a dialog takes the focus when it opens and gives it back when it closes", async () => {
    document.body.innerHTML = `<button id="opener">open</button>`;
    const stop = installModalFocus();
    const opener = document.getElementById("opener")!;
    opener.focus();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<button id="a">a</button><button id="b">b</button>`;
    document.body.appendChild(dialog);
    await tick();
    expect(document.activeElement?.id, "the dialog's first control").toBe("a");
    dialog.remove();
    await tick();
    expect(document.activeElement?.id, "back where it was").toBe("opener");
    stop();
  });

  it("Tab and Shift+Tab wrap inside the dialog", async () => {
    document.body.innerHTML = `<button id="out">out</button><div role="dialog" aria-modal="true"><button id="a">a</button><input id="b"/><button id="c">c</button></div>`;
    const stop = installModalFocus();
    await tick();
    document.getElementById("c")!.focus();
    const e = press();
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id, "from the last to the first").toBe("a");
    press(true);
    expect(document.activeElement?.id, "from the first back to the last").toBe("c");
    stop();
  });

  it("a focus that has wandered out is brought back into the dialog on top", () => {
    document.body.innerHTML = `<button id="out">out</button><div id="d" role="dialog" aria-modal="true"><button id="a">a</button><button id="z">z</button></div>`;
    document.getElementById("out")!.focus();
    const box = document.getElementById("d")!;
    trapTab({ shiftKey: false, preventDefault: () => undefined }, box);
    expect(document.activeElement?.id).toBe("a");
    trapTab({ shiftKey: true, preventDefault: () => undefined }, box);
    expect(document.activeElement?.id, "Shift+Tab from inside the first goes to the last").toBe("z");
  });

  it("of two open dialogs, the one drawn above is on top", () => {
    document.body.innerHTML = `<div id="low" aria-modal="true" style="z-index: 21"></div><div id="high" aria-modal="true" style="z-index: 40"></div><div id="later" aria-modal="true" style="z-index: 21"></div>`;
    expect(topModal()?.id).toBe("high");
  });

  it("a dialog with nothing to press takes the focus itself", async () => {
    document.body.innerHTML = `<button id="opener">open</button>`;
    const stop = installModalFocus();
    document.getElementById("opener")!.focus();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    dialog.textContent = "Saved.";
    document.body.appendChild(dialog);
    await tick();
    expect(document.activeElement).toBe(dialog);
    stop();
  });

  it("Escape closes the dialog on top by its way out, and the focus goes back to where it was (R73)", async () => {
    document.body.innerHTML = `<button id="opener">open</button>`;
    const stop = installModalFocus();
    document.getElementById("opener")!.focus();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<button id="wait" data-dismiss>I'll wait</button><button id="all">Open everything now</button>`;
    let waited = 0;
    dialog.querySelector("#wait")!.addEventListener("click", () => (waited++, dialog.remove()));
    document.body.appendChild(dialog);
    await tick();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(e);
    expect(waited, "its way out was taken, not the other choice").toBe(1);
    expect(e.defaultPrevented).toBe(true);
    await tick();
    expect(document.activeElement?.id, "back on the control that opened it").toBe("opener");
    stop();
  });

  it("Escape takes a dialog's close button too, closes only the one on top, and leaves a sheet under it (R73)", async () => {
    document.body.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" style="z-index: 21"><button id="s">x</button></div>
      <div id="top" role="dialog" aria-modal="true" style="z-index: 40"><button aria-label="Close" id="c">x</button></div>`;
    const stop = installModalFocus();
    let sheetHeard = 0;
    window.addEventListener("keydown", () => sheetHeard++);
    const top = document.getElementById("top")!;
    top.querySelector("#c")!.addEventListener("click", () => top.remove());
    await tick();
    document.getElementById("c")!.focus();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("top"), "the dialog on top closed").toBeNull();
    expect(sheetHeard, "the sheet under it never heard that Escape").toBe(0);
    stop();
  });

  it("a dialog that asks for an answer is not answered by Escape, and a sheet on top closes itself (R73)", async () => {
    document.body.innerHTML = `<div id="ask" role="dialog" aria-modal="true"><button id="yes">Accept</button><button id="no">Decline</button></div>`;
    const stop = installModalFocus();
    let answered = 0;
    for (const b of Array.from(document.querySelectorAll("#ask button"))) b.addEventListener("click", () => answered++);
    await tick();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(e);
    expect(answered).toBe(0);
    expect(e.defaultPrevented).toBe(false);
    // a sheet handles its own Escape (Sheets.tsx): nothing here presses its close button for it
    document.body.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button aria-label="Close" id="c">x</button></div>`;
    let closed = 0;
    document.getElementById("c")!.addEventListener("click", () => closed++);
    document.getElementById("c")!.focus();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closed).toBe(0);
    stop();
  });
});
