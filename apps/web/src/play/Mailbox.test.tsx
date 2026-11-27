// @vitest-environment happy-dom
/**
 * R36: an empty mailbox is drawn as every other empty list in the game is, the resident cat with a line (CuteState),
 * not a bare line; a mailbox still fetching shows the cat looking up, as the game's other waits do.
 *
 * R40: a mailbox whose letters could not be fetched says so, and offers to fetch them again; it never claims to be
 * empty (a dropped connection read as "No letters yet.", and a gift waiting in a letter looked like none was sent).
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Net, json, leave, offline, visit } from "../game/testGame";

afterEach(() => leave());

/** A server (or, in a build with none, the file shipped beside the page) that answers with these letters. */
const answering =
  (letters: unknown[]): Net =>
  async (url) =>
    url.endsWith("mail.json") ? json(letters) : json({ ok: true, letters });

const letter = {
  id: "welcome",
  at: Date.UTC(2026, 10, 20),
  subject: { en: "Welcome to Lingxi", zh: "欢迎来到灵犀" },
  body: { en: "Hello", zh: "你好" },
};

async function openMailbox(lang: "en" | "zh", net: Net) {
  const page = await visit({ at: Date.UTC(2026, 10, 27, 9), net });
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
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  await settle();
  return {
    host,
    net: page.net,
    settle,
    retry: () => host.querySelector<HTMLButtonElement>(".panel-failed .btn, .mail-failed .btn"),
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
      const m = await openMailbox(lang, answering([]));
      const state = m.host.querySelector(".cute-state");
      expect(state, "the empty state is the cat and a line").not.toBeNull();
      expect(state?.querySelector(".cute-art canvas"), "with the cat drawn").not.toBeNull();
      expect(state?.textContent).toBe(empty);
      expect(state?.classList.contains("busy"), "nothing is still coming").toBe(false);
      expect(m.host.querySelector(".mail-list"), "and no list of letters").toBeNull();
      expect(m.retry(), "an empty mailbox has nothing to fetch again").toBeNull();
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

describe("a mailbox whose letters could not be fetched (R40)", () => {
  for (const [lang, said, again, empty] of [
    ["en", "The mail couldn't be fetched just now. Nothing in it is lost.", "Try again", "No letters yet."],
    ["zh", "暂时取不到信。信都还在，不会丢。", "再试一次", "还没有信。"],
  ] as const) {
    it(`says so, never that it is empty, and offers to fetch it again (${lang})`, async () => {
      const m = await openMailbox(lang, offline);
      expect(m.host.textContent, "a failed fetch is not an empty mailbox").not.toContain(empty);
      const failed = m.host.querySelector(".panel-failed");
      expect(failed, "the failure is said").not.toBeNull();
      expect(failed?.getAttribute("role"), "and a screen reader hears it").toBe("alert");
      expect(
        failed?.querySelector(".cute-art canvas"),
        "with the cat, as the game's other failed panels",
      ).not.toBeNull();
      expect(failed?.textContent).toContain(said);
      expect(m.retry()?.textContent).toBe(again);
      m.close();
    });
  }

  it("is a failure too when the server answers with an error, or with something that is not the letters", async () => {
    for (const net of [
      async () => json({ ok: false }, 503),
      async () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
      async () => json({ ok: false }),
    ] satisfies Net[]) {
      const m = await openMailbox("en", net);
      expect(m.host.querySelector(".panel-failed"), "said as a failure").not.toBeNull();
      expect(m.host.textContent).not.toContain("No letters yet.");
      m.close();
      leave();
    }
  });

  it("Try again fetches the mail afresh: the cat looks up while it comes, then the letters are there", async () => {
    let answer: Net = offline;
    const m = await openMailbox("en", (url, init) => answer(url, init));
    expect(m.net, "one request as it opened").toHaveBeenCalledTimes(1);
    // the connection is back, but slow: the retry is seen to be under way
    let arrive: () => void = () => {};
    answer = (url) =>
      new Promise<Response>((done) => {
        arrive = () => void answering([letter])(url).then(done);
      });
    await act(async () => m.retry()?.click());
    expect(m.net, "Try again asked once more").toHaveBeenCalledTimes(2);
    expect(m.host.querySelector(".cute-state.busy")?.textContent, "fetching, said as it is").toBe("Fetching the mail…");
    expect(m.host.querySelector(".panel-failed"), "the failure is gone while it tries").toBeNull();
    await act(async () => arrive());
    await m.settle();
    expect(m.host.querySelector(".mail-list")?.textContent).toContain("Welcome to Lingxi");
    expect(m.host.querySelector(".panel-failed, .mail-failed"), "and nothing says it failed").toBeNull();
    m.close();
  });

  it("with the game's own letters to show, they are listed, and the failure is said above them", async () => {
    let calls = 0;
    const m = await openMailbox("zh", async (url, init) => {
      calls += 1;
      return offline(url, init);
    });
    // the mailbox was fetched once as it opened; a letter the game wrote on this device arrives
    const { useMail } = await import("../game/mail");
    await act(async () => useMail.getState().write({ ...letter, id: "season-1", at: Date.UTC(2026, 10, 26) }));
    expect(m.host.querySelector(".mail-list"), "the game's own letter is listed").not.toBeNull();
    const note = m.host.querySelector(".mail-failed");
    expect(note?.textContent).toContain("灵犀的一些来信暂时没取到。");
    expect(m.retry()?.textContent).toBe("再试一次");
    await act(async () => m.retry()?.click());
    expect(calls, "and Try again asks again").toBe(2);
    m.close();
  });
});
