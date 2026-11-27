// @vitest-environment happy-dom
/**
 * R36: an empty mailbox is drawn as every other empty list in the game is, the resident cat with a line (CuteState),
 * not a bare line; a mailbox still fetching shows the cat looking up, as the game's other waits do.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Net, leave, visit } from "../game/testGame";

afterEach(() => leave());

async function openMailbox(lang: "en" | "zh", net?: Net) {
  await visit({ at: Date.UTC(2026, 10, 27, 9), ...(net ? { net } : {}) });
  // the cat is drawn on a canvas, which this test does not look at: a 2D context that draws nothing
  const ctx = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    clearRect: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    imageSmoothingEnabled: false,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  const { MailboxPanel } = await import("./Mailbox");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(MailboxPanel)));
  // the mailbox asks for its letters as it opens; the answer (or the failure) lands on the next turns
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  return {
    host,
    close: () => {
      act(() => root.unmount());
      host.remove();
      MotionGlobalConfig.skipAnimations = false;
    },
  };
}

describe("the mailbox's empty and waiting states (R36)", () => {
  for (const [lang, empty] of [
    ["en", "No letters yet."],
    ["zh", "还没有信。"],
  ] as const) {
    it(`with no letters, the cat naps beside the line (${lang})`, async () => {
      const m = await openMailbox(lang);
      const state = m.host.querySelector(".cute-state");
      expect(state, "the empty state is the cat and a line").not.toBeNull();
      expect(state?.querySelector(".cute-art canvas"), "with the cat drawn").not.toBeNull();
      expect(state?.textContent).toBe(empty);
      expect(state?.classList.contains("busy"), "nothing is still coming").toBe(false);
      expect(m.host.querySelector(".mail-list"), "and no list of letters").toBeNull();
      m.close();
    });
  }

  for (const [lang, waiting] of [
    ["en", "Fetching the mail…"],
    ["zh", "正在取信……"],
  ] as const) {
    it(`while the letters are fetched, the cat looks up and says so (${lang})`, async () => {
      // a server that has not answered yet
      const m = await openMailbox(lang, () => new Promise<Response>(() => {}));
      const state = m.host.querySelector(".cute-state.busy");
      expect(state, "the waiting state is the busy cat").not.toBeNull();
      expect(state?.getAttribute("role"), "and a screen reader hears it").toBe("status");
      expect(state?.textContent).toBe(waiting);
      m.close();
    });
  }
});
