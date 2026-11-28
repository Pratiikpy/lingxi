// @vitest-environment happy-dom
/**
 * R65: a new player's badge shelf asked to "Teach 1 lessons", "Send 1 gifts" and six more in the plural. Every goal of
 * one now reads in the singular in English; Chinese is unchanged, having no plural.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { leave, show, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

async function shelf(lang: "en" | "zh") {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  const { useLang } = await import("../i18n");
  const { BadgeShelf } = await import("./Badges");
  useLang.setState({ lang });
  const view = await show(createElement(BadgeShelf));
  const goals = Array.from(document.querySelectorAll(".badge .next")).map((e) => e.textContent ?? "");
  return { goals, view };
}

describe("the badge shelf's goals of one (R65)", () => {
  it("says one of a thing in the singular, for every badge a new player sees", async () => {
    const { goals, view } = await shelf("en");
    expect(goals).toContain("Teach 1 lesson");
    expect(goals).toContain("Send 1 gift");
    expect(goals).toContain("Save 1 day on X Layer");
    expect(goals).toContain("Nurse a sick pet back once");
    for (const g of goals)
      expect(g).not.toMatch(/\b1 (?:[a-z-]+ )?(?:lessons|gifts|times|pets|little ones|spars|days|parties)\b/);
    view.unmount();
  });

  it("and the Chinese reads as before", async () => {
    const { goals, view } = await shelf("zh");
    expect(goals).toContain("教会 1 课");
    expect(goals).toContain("送出 1 份礼物");
    view.unmount();
  });
});
