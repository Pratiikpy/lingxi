// @vitest-environment happy-dom
/**
 * R64: the Pet sheet says a pet's nature as its egg's line, and its habits beside it. A Bold egg taught to share read
 * "Nature: gentle, greedy" after its first lesson and a meal: one point of drift (of fifteen) had become its nature.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HABIT } from "@lingxi/game";
import { leave, show, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

/** The Pet sheet's rows for a Bold pet with these traits, as label and value. */
async function rows(lang: "en" | "zh", traits: Record<string, number>) {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const { useGame } = await import("../game/store");
  const { useLang } = await import("../i18n");
  const { MeSheetBody } = await import("./Sheets");
  useLang.setState({ lang });
  useGame.getState().hatch("bold", "Biscuit");
  const pet = useGame.getState().pet!;
  const view = await show(createElement(MeSheetBody, { pet: { ...pet, traits: { ...pet.traits, ...traits } } }));
  const dts = Array.from(document.querySelectorAll(".rows dt"));
  const read = (label: string) => dts.find((d) => d.textContent === label)?.nextElementSibling?.textContent ?? null;
  return { read, view };
}

describe("the Pet sheet's nature (R64)", () => {
  it("a Bold egg taught to share and fed is Bold, growing gentle, not 'gentle, greedy'", async () => {
    const { read, view } = await rows("en", { gentle: 2, greedy: 1 });
    expect(read("Nature")).toBe("Bold");
    expect(read("Habits")).toBe("growing gentle");
    view.unmount();
  });

  it("a new pet has no habits yet, and says how they come", async () => {
    const { read, view } = await rows("zh", {});
    expect(read("性格")).toBe("勇敢");
    expect(read("习惯")).toBe("还没有，会从它做的事里慢慢养成");
    view.unmount();
  });

  it("habits are named from HABIT on, the strongest two, the nature still its line", async () => {
    const { read, view } = await rows("en", { gentle: HABIT + 2, greedy: HABIT, shy: HABIT + 1 });
    expect(read("Nature")).toBe("Bold");
    expect(read("Habits")).toBe("gentle, shy");
    view.unmount();
  });
});
