// @vitest-environment happy-dom
/**
 * P3: panels the game's start-up does not carry. A deferred component draws nothing until its code arrives and never
 * suspends what is around it (which would blank the whole game behind its splash); the warm-up fetches every deferred
 * component's code later, one at a time, once the game has been up a while or the player first touches it.
 */
import { Suspense, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A load that resolves only when told to, counting how often it was asked for. */
function gate<T>(value: T) {
  let release: () => void = () => {};
  const ready = new Promise<void>((r) => (release = r));
  const load = vi.fn(async () => {
    await ready;
    return value;
  });
  return { load, release };
}

const fresh = async () => {
  vi.resetModules();
  return import("./Lazy");
};

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a deferred component (P3)", () => {
  it("draws nothing in its place until its code arrives, then draws itself, never showing the outer fallback", async () => {
    const { deferred } = await fresh();
    const Panel = ({ word }: { word: string }) => createElement("p", { className: "panel" }, word);
    const g = gate(Panel);
    const Lazy = deferred(g.load);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("b", { className: "splash" }, "loading") },
          createElement("main", null, "game", createElement(Lazy, { word: "hello" })),
        ),
      ),
    );
    expect(host.querySelector(".splash")).toBeNull();
    expect(host.querySelector("main")?.textContent).toBe("game");
    await act(async () => {
      g.release();
      await Promise.resolve();
    });
    expect(host.querySelector(".panel")?.textContent).toBe("hello");
    expect(host.querySelector(".splash")).toBeNull();
    act(() => root.unmount());
  });
});

describe("warming the deferred code (P3)", () => {
  const idleNow = () => vi.stubGlobal("requestIdleCallback", (f: () => void) => setTimeout(f, 0));

  it("waits for the game to have been up a while, then loads each component's code one at a time", async () => {
    vi.useFakeTimers();
    idleNow();
    const { deferred, warmDeferred, WARM_AFTER_MS } = await fresh();
    const a = gate(() => null);
    const b = gate(() => null);
    deferred(a.load);
    deferred(b.load);
    const stop = warmDeferred();
    await vi.advanceTimersByTimeAsync(WARM_AFTER_MS - 1);
    expect(a.load).not.toHaveBeenCalled();
    // at the mark it starts, in the next idle moment
    await vi.advanceTimersByTimeAsync(10);
    expect(a.load).toHaveBeenCalledTimes(1);
    // the next waits for the first to arrive
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.load).not.toHaveBeenCalled();
    a.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(b.load).toHaveBeenCalledTimes(1);
    stop();
    vi.unstubAllGlobals();
  });

  it("starts at once when the player first touches the screen", async () => {
    vi.useFakeTimers();
    idleNow();
    const { deferred, warmDeferred } = await fresh();
    const a = gate(() => null);
    deferred(a.load);
    const stop = warmDeferred();
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(10);
    expect(a.load).toHaveBeenCalledTimes(1);
    stop();
    vi.unstubAllGlobals();
  });

  it("does nothing once stopped, and a load that fails does not stop the rest", async () => {
    vi.useFakeTimers();
    idleNow();
    const { deferred, warmDeferred, WARM_AFTER_MS } = await fresh();
    const bad = vi.fn(async () => {
      throw new Error("offline");
    });
    const good = gate(() => null);
    deferred(bad);
    deferred(good.load);
    const stop = warmDeferred();
    await vi.advanceTimersByTimeAsync(WARM_AFTER_MS + 10);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good.load).toHaveBeenCalledTimes(1);

    const later = await fresh();
    const never = gate(() => null);
    later.deferred(never.load);
    later.warmDeferred()();
    await vi.advanceTimersByTimeAsync(later.WARM_AFTER_MS * 2);
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(10);
    expect(never.load).not.toHaveBeenCalled();
    stop();
    vi.unstubAllGlobals();
  });
});
