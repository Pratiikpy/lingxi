// @vitest-environment happy-dom
/**
 * R75: the lesson library with nothing on its shelf. It showed the resident cat asleep in a dashed pink box, the same
 * box as the notice under it that teaching in words is resting, and told the player to teach in their own words, which
 * is often exactly what is resting. It is now a designed empty shelf: a title, what the shelf is for and how a lesson
 * gets onto it (built here or said in words, shared when taught), and a way to start, which opens the rule builder.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, settle, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

async function teach(lang: "en" | "zh") {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    clearRect: () => {},
    fillRect: () => {},
    drawImage: () => {},
  } as never);
  const { useGame } = await import("../game/store");
  const { useLang } = await import("../i18n");
  const { TeachPanel } = await import("./Teach");
  const { libraryAvailable } = await import("../game/library");
  useLang.setState({ lang });
  useGame.getState().hatch("gentle", "Kiko");
  const host = document.createElement("div");
  host.className = "sbody";
  host.style.overflowY = "auto";
  host.scrollTo = (() => {}) as typeof host.scrollTo;
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(TeachPanel, { pet: useGame.getState().pet! })));
  // the library asks the server for its shelf; this test's network never answers, so it is read as empty
  await act(async () => void (await settle(Promise.resolve(), 50, 10)));
  return { host, available: libraryAvailable(), unmount: () => act(() => root.unmount()) };
}

describe("the lesson library's empty shelf (R75)", () => {
  it("is a designed empty state with a title, how a lesson gets there, and a way to start", async () => {
    const { host, available, unmount } = await teach("en");
    expect(available, "this test page has a server to ask").toBe(true);
    const empty = host.querySelector(".lib-empty");
    expect(empty, "the shelf's own empty state").not.toBeNull();
    expect(empty!.querySelector(".cute-state"), "not the notice box the other states use").toBeNull();
    expect(empty!.querySelector("b")?.textContent).toBe("The shelf is empty for now");
    expect(empty!.textContent).toContain("tick the box to share it in the library");
    const start = empty!.querySelector<HTMLButtonElement>("button")!;
    expect(start.textContent).toBe("Build a rule");
    const build = host.querySelector<HTMLDetailsElement>("details.build")!;
    expect(build.open).toBe(false);
    await act(async () => start.click());
    expect(build.open, "the builder opens").toBe(true);
    expect(document.activeElement, "and has the focus").toBe(build.querySelector("summary"));
    unmount();
  });

  it("reads in Chinese", async () => {
    const { host, unmount } = await teach("zh");
    const empty = host.querySelector(".lib-empty")!;
    expect(empty.querySelector("b")?.textContent).toBe("书架暂时还空着");
    expect(empty.querySelector("button")?.textContent).toBe("自己拼一条规则");
    unmount();
  });
});
