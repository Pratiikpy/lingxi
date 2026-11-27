// @vitest-environment happy-dom
/**
 * R40: while a dialog lies over the room (a quest's lines, a gift, a proposal) its dim leaves only the dialog to look
 * at. The room's news waits for it, as the pet's passing words already do (R36): a new badge and a quest's toast drawn
 * near white were the lightest things under the dim. Each waits whole, so its few seconds on screen begin once the
 * dialog has closed, and a screen reader hears it then.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

async function room(lang: "en" | "zh" = "en") {
  await visit({ at: Date.UTC(2026, 10, 27, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  const { useGame } = await import("../game/store");
  useGame.getState().hatch("gentle", "Kiri");
  const { BadgeToast } = await import("./Badges");
  const { QuestToast } = await import("./Quests");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement("div", { className: "notice-lane" }, [
        createElement(QuestToast, { key: "q", onOpenBook: () => undefined }),
        createElement(BadgeToast, { key: "b" }),
      ]),
    ),
  );
  const dialog = document.createElement("div");
  dialog.className = "fam-modal";
  dialog.setAttribute("role", "dialog");
  return {
    host,
    open: () => act(async () => void document.body.append(dialog)),
    shut: () => act(async () => dialog.remove()),
    wait: (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      }),
    said: () => Array.from(host.querySelectorAll("[role=status]"), (s) => s.textContent ?? "").join(" | "),
    close: () => {
      dialog.remove();
      act(() => root.unmount());
      host.remove();
      MotionGlobalConfig.skipAnimations = false;
    },
  };
}

describe("the room's news under a dialog (R40)", () => {
  it("a badge earned while a dialog is open waits for it, then has its full time", async () => {
    const r = await room();
    const { useBadges } = await import("../game/badges");
    await r.open();
    // a lifetime of cleaning reaches the bronze tier while the dialog is open
    await act(async () => useBadges.getState().note("clean", 20));
    expect(useBadges.getState().fresh, "the badge is earned").toHaveLength(1);
    expect(r.host.querySelector(".badge-toast"), "but nothing is drawn under the dialog").toBeNull();
    expect(r.said(), "nor said yet").not.toMatch(/New badge/);
    await r.wait(10_000);
    expect(useBadges.getState().fresh, "it waits, however long the dialog stays").toHaveLength(1);
    await r.shut();
    expect(r.host.querySelector(".badge-toast"), "shown once the dialog has closed").not.toBeNull();
    expect(r.said()).toMatch(/New badge: Spotless · Bronze/);
    await r.wait(3_000);
    expect(r.host.querySelector(".badge-toast"), "with its own seconds, from then").not.toBeNull();
    await r.wait(700);
    expect(r.host.querySelector(".badge-toast"), "and then it goes").toBeNull();
    r.close();
  });

  it("a badge on screen when a dialog opens steps aside, and comes back with its time whole", async () => {
    const r = await room("zh");
    const { useBadges } = await import("../game/badges");
    await act(async () => useBadges.getState().note("clean", 20));
    expect(r.host.querySelector(".badge-toast")).not.toBeNull();
    await r.wait(2_000);
    await r.open();
    expect(r.host.querySelector(".badge-toast"), "it steps aside for the dialog").toBeNull();
    await r.wait(10_000);
    await r.shut();
    expect(r.host.querySelector(".badge-toast"), "back after the dialog").not.toBeNull();
    expect(r.said()).toMatch(/新徽章/);
    await r.wait(3_000);
    expect(r.host.querySelector(".badge-toast"), "its seconds begin again").not.toBeNull();
    r.close();
  });

  it("a quest's toast waits for the dialog too", async () => {
    const r = await room();
    const { useQuestUi } = await import("../game/questUi");
    await r.open();
    await act(async () => useQuestUi.getState().push({ quest: "q02", kind: "new" }));
    expect(r.host.querySelector(".quest-toast"), "nothing under the dialog").toBeNull();
    await r.wait(10_000);
    expect(useQuestUi.getState().note, "the news is kept").not.toBeNull();
    await r.shut();
    expect(r.host.querySelector(".quest-toast"), "shown once it has closed").not.toBeNull();
    await r.wait(4_000);
    expect(r.host.querySelector(".quest-toast"), "with its own seconds").not.toBeNull();
    await r.wait(300);
    expect(r.host.querySelector(".quest-toast")).toBeNull();
    r.close();
  });

  it("with no dialog, a badge and a quest's toast show at once, as before", async () => {
    const r = await room();
    const { useBadges } = await import("../game/badges");
    const { useQuestUi } = await import("../game/questUi");
    await act(async () => useBadges.getState().note("clean", 20));
    await act(async () => useQuestUi.getState().push({ quest: "q02", kind: "new" }));
    expect(r.host.querySelector(".badge-toast")).not.toBeNull();
    expect(r.host.querySelector(".quest-toast")).not.toBeNull();
    r.close();
  });
});
