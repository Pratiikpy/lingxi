/** A4: a page left open across a release whose part fails to load reloads once into the release live now. */
import { describe, expect, it, vi } from "vitest";

describe("a page left open across a deploy whose part fails to load (A4)", () => {
  it("reloads once into the build that is live now, and never again for the same build", async () => {
    const page = new EventTarget();
    const session = new Map<string, string>();
    const reload = vi.fn();
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", { querySelector: () => ({ src: "https://lingxi.knole.me/assets/play-A.js" }) });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
    });
    vi.stubGlobal("location", { reload, pathname: "/play.html" });
    try {
      await import("./staleBuild");
      const partFails = () => {
        const e = new Event("vite:preloadError", { cancelable: true });
        page.dispatchEvent(e);
        return e.defaultPrevented;
      };
      expect(partFails()).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
      // the same build failing again after its reload is left to the crash guard's message, not reloaded in a loop
      expect(partFails()).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
