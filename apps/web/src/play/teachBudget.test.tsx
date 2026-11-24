// @vitest-environment happy-dom
/**
 * G7: the Teach screen's gate meter shows what the pet's lessons use against its stage's taught budget, measured with the pet's own
 * skills, so a Mind gate skill visibly widens it.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PET_SCHOOL, TAUGHT_BUDGET, taughtGates } from "@lingxi/game";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

const AT = Date.UTC(2026, 10, 21, 9);
const DAY = 86_400_000;

async function teachScreen(
  lang: "en" | "zh",
  growth?: { level: number; points: number; skills: Record<number, number> },
) {
  await visit({ at: AT });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useGame } = await import("../game/store");
  const { useLang } = await import("../i18n");
  const { GateMeter } = await import("./Teach");
  useLang.setState({ lang });
  useGame.getState().hatch("gentle", "Kiri");
  // a teen: five days old by its birth time (its clock is not moved)
  const p0 = useGame.getState().pet!;
  useGame.setState({ pet: { ...p0, bornAt: p0.bornAt - 5 * DAY, ...(growth ? { growth } : {}) } });
  for (const id of ["share", "nap"])
    expect(useGame.getState().learn(PET_SCHOOL.find((l) => l.id === id)!.rule).ok).toBe(true);
  const pet = useGame.getState().pet!;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(GateMeter, { pet })));
  const close = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, pet, close };
}

describe("the Teach screen shows the taught budget (G7)", () => {
  it("says what the lessons use of a teen's budget, in English and Chinese", async () => {
    for (const lang of ["en", "zh"] as const) {
      const { host, pet, close } = await teachScreen(lang);
      const used = taughtGates({ line: pet.line, lessons: pet.lessons, instincts: pet.instincts });
      expect(used).toBeGreaterThan(0);
      const text = host.querySelector(".gates")!.textContent!;
      expect(text).toContain(
        lang === "en"
          ? `Lessons use ${used} of ${TAUGHT_BUDGET.teen} gates`
          : `课程用了 ${used}/${TAUGHT_BUDGET.teen} 个门`,
      );
      close();
      leave();
    }
  });

  it("a Mind gate skill widens the number shown", async () => {
    const { host, close } = await teachScreen("en", { level: 10, points: 0, skills: { 211: 2 } });
    // two points of Wide Mind: 20 gates for the brain, a third of them (6) for lessons (D3)
    expect(host.querySelector(".gates")!.textContent).toContain(`of ${TAUGHT_BUDGET.teen + 6} gates`);
    close();
  });
});
