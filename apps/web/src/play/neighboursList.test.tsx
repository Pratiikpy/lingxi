// @vitest-environment happy-dom
/**
 * R71: the Pet sheet's list of neighbours. The Builders' Lane pets showed placeholders ("13" for Behemoth, "◆" for the
 * rest) beside the residents' portraits, and every one of the fourteen carried the step-waiting star on day 1: each
 * friendship's first step is open from the start, most of them with someone in a room the player has never been to.
 * The lane pets are drawn as themselves, and the star stands only where a step waits with a neighbour the player has
 * met (been to their room, met on the lane, or begun a friendship with).
 */
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDER_PET } from "@lingxi/game";
import { CHARACTERS } from "@lingxi/world";
import { leave, show, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

async function list() {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    clearRect: () => {},
    drawImage: () => {},
  } as never);
  const { useLang } = await import("../i18n");
  useLang.setState({ lang: "en" });
  const { NeighboursPanel } = await import("./Neighbours");
  const { useBuilders } = await import("../game/builderScene");
  const { useBadges } = await import("../game/badges");
  const view = await show(createElement(NeighboursPanel));
  const row = (name: string) =>
    Array.from(document.querySelectorAll(".nb-list > li")).find((li) =>
      li.querySelector("b")?.textContent?.startsWith(name),
    );
  return { view, row, useBuilders, useBadges };
}

describe("the neighbours list (R71)", () => {
  it("draws every Builders' Lane pet as itself, never a placeholder", async () => {
    const { view } = await list();
    const lane = Array.from(document.querySelectorAll(".nb-list .nb-lane-face"));
    expect(lane).toHaveLength(5);
    for (const face of lane) {
      expect(face.querySelector("canvas"), "a drawn portrait").not.toBeNull();
      expect(face.textContent, "no '13' or '◆'").toBe("");
    }
    view.unmount();
  });

  it("on day 1 no star stands by anyone the player has not met", async () => {
    const { view } = await list();
    expect(document.querySelectorAll(".nb-star")).toHaveLength(0);
    view.unmount();
  });

  it("a star stands by a lane pet once met, and by a resident once the player has been to their room", async () => {
    const { view, row, useBuilders, useBadges } = await list();
    const behemoth = BUILDER_PET.behemoth.name.en;
    const resident = CHARACTERS[0]!;
    await act(async () => useBuilders.getState().meet("behemoth"));
    expect(row(behemoth)?.querySelector(".nb-star"), "Behemoth met on the lane: its first step waits").not.toBeNull();
    expect(row(resident.name.en)?.querySelector(".nb-star")).toBeNull();
    await act(async () => useBadges.getState().visit(resident.room));
    expect(row(resident.name.en)?.querySelector(".nb-star"), "been to their room").not.toBeNull();
    expect(document.querySelectorAll(".nb-star")).toHaveLength(2);
    view.unmount();
  });
});
