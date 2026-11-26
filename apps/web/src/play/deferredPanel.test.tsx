// @vitest-environment happy-dom
/**
 * R33: a sheet's panel whose code loads on first use says what is happening. While its code is on the way the sheet
 * shows that it is getting the panel ready (not an empty gap that fills in later); if the code cannot be fetched, a
 * plain message in the player's language with a Try again that fetches it afresh, never the whole game's crash screen;
 * a panel that fails while drawing is not dressed up as a connection problem: that still reaches the game's guard.
 */
import { Component, type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fresh = async (lang: "en" | "zh" = "en") => {
  vi.resetModules();
  const { useLang } = await import("../i18n");
  useLang.setState({ lang });
  return import("./Lazy");
};

/** The game's own guard, standing in: records what reached it. */
class Outer extends Component<{ children: ReactNode }, { failed: string | null }> {
  override state = { failed: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { failed: e.message };
  }
  override render() {
    return this.state.failed ? createElement("b", { className: "crash" }, this.state.failed) : this.props.children;
  }
}

function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return { host, root, render: () => act(async () => root.render(createElement(Outer, null, node))) };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // the resident cat is drawn on a canvas, which this page has none of: a pencil that draws nothing stands in
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    clearRect: () => {},
    drawImage: () => {},
  } as never);
});

describe("a sheet's panel loaded on first use (R33)", () => {
  it("says it is getting the panel ready while its code is on the way, then draws the panel", async () => {
    const { deferredPanel } = await fresh();
    let release: () => void = () => {};
    const ready = new Promise<void>((r) => (release = r));
    const Panel = deferredPanel(async () => {
      await ready;
      return ({ word }: { word: string }) => createElement("p", { className: "panel" }, word);
    });
    const m = mount(createElement(Panel, { word: "hello" }));
    await m.render();
    const wait = m.host.querySelector(".panel-wait");
    expect(wait?.querySelector('[role="status"]')).not.toBeNull();
    expect(wait?.textContent).toMatch(/getting it ready/i);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await flush();
    expect(m.host.querySelector(".panel-wait")).toBeNull();
    expect(m.host.querySelector(".panel")?.textContent).toBe("hello");
    act(() => m.root.unmount());
  });

  it("says plainly, in Chinese too, that the panel did not load, and Try again fetches its code afresh", async () => {
    const { deferredPanel } = await fresh("zh");
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new TypeError("Failed to fetch dynamically imported module");
      return () => createElement("p", { className: "panel" }, "loaded");
    });
    const Panel = deferredPanel(load);
    const m = mount(createElement(Panel));
    await m.render();
    await flush();
    const failed = m.host.querySelector(".panel-failed");
    expect(m.host.querySelector(".crash")).toBeNull();
    expect(failed?.getAttribute("role")).toBe("alert");
    expect(failed?.textContent).toContain("没有加载出来");
    const retry = failed?.querySelector("button");
    expect(retry?.textContent).toBe("再试一次");
    fail = false;
    await act(async () => retry?.click());
    await flush();
    expect(m.host.querySelector(".panel-failed")).toBeNull();
    expect(m.host.querySelector(".panel")?.textContent).toBe("loaded");
    // warmed once at start-up, then fetched by the first draw and again by the retry
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);
    act(() => m.root.unmount());
  });

  it("leaves a panel that fails while drawing to the game's own guard", async () => {
    const { deferredPanel } = await fresh();
    const Panel = deferredPanel(async () => () => {
      throw new Error("a drawing bug");
    });
    const m = mount(createElement(Panel));
    await m.render();
    await flush();
    expect(m.host.querySelector(".panel-failed")).toBeNull();
    expect(m.host.querySelector(".crash")?.textContent).toBe("a drawing bug");
    act(() => m.root.unmount());
  });

  // R35: the Pet sheet's panels (its diary, family, studio, shops ...) and the collection have the same loading state and
  // Try again, but most visits never open them, so their code is not fetched in the start-up warm-up as the tabs' is
  it("fetches a panel made with warm: false only when it is drawn, not in the start-up warm-up", async () => {
    const { deferredPanel } = await fresh();
    const { warmDeferred } = await import("../game/warm");
    const cold = vi.fn(async () => () => createElement("p", { className: "cold" }, "cold"));
    const warmed = vi.fn(async () => () => createElement("p", { className: "warm" }, "warm"));
    const Cold = deferredPanel(cold, { warm: false });
    deferredPanel(warmed);
    const stop = warmDeferred();
    // a first touch starts the warm-up at once; it fetches one module per idle moment
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(warmed).toHaveBeenCalled();
    expect(cold).not.toHaveBeenCalled();
    const m = mount(createElement(Cold));
    await m.render();
    await flush();
    expect(cold).toHaveBeenCalledTimes(1);
    expect(m.host.querySelector(".cold")?.textContent).toBe("cold");
    stop();
    act(() => m.root.unmount());
  });
});
