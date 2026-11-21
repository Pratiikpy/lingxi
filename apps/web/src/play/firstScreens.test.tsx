// @vitest-environment happy-dom
/**
 * B5: the first screens. The room's familiarity meter is a labelled chip a phone player can read and tap; a badge
 * earned by teaching waits while Try it asks about the lesson; the "Rules verified" mark pops up once for a set of
 * rules, not on every load.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => {
  leave();
  MotionGlobalConfig.skipAnimations = false;
});

async function mount(el: () => ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(el()));
  return {
    host,
    rerender: async () => act(async () => root.render(el())),
    close: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe("the first screens (B5)", () => {
  it("the familiarity meter says what it is in words, at nothing known too, and explains itself on a tap", async () => {
    await visit({ at: Date.UTC(2026, 10, 22, 9) });
    const { Familiar } = await import("./Familiar");
    const { host, close } = await mount(() => createElement(Familiar, { known: 0, size: 5 }));
    const chip = host.querySelector("button.familiar")!;
    expect(chip.textContent).toContain("Known 0/5");
    expect(host.querySelector(".familiar-why")).toBeNull();
    await act(async () => (chip as HTMLButtonElement).click());
    expect(host.querySelector(".familiar-why")?.textContent).toMatch(/Look around here often/);
    close();
  });

  it("a badge earned by teaching waits while Try it is up, then shows", async () => {
    await visit({ at: Date.UTC(2026, 10, 22, 9) });
    const { BadgeToast } = await import("./Badges");
    const { useBadges } = await import("../game/badges");
    const { useTrial } = await import("../game/tryIt");
    const { BADGES } = await import("@lingxi/game");
    useTrial.setState({ offering: true });
    useBadges.setState({ fresh: [{ id: 1, badge: BADGES[0]!, tier: 1 }] } as never);
    const { host, rerender, close } = await mount(() => createElement(BadgeToast));
    expect(host.querySelector(".badge-toast"), "held while Try it asks").toBeNull();
    await act(async () => useTrial.setState({ offering: false }));
    await rerender();
    expect(host.querySelector(".badge-toast")).not.toBeNull();
    close();
  });

  it("the rules mark pops up the first time a set of rules is verified, and not on the next load", async () => {
    await visit({ at: Date.UTC(2026, 10, 22, 9) });
    const { useRulesCheck } = await import("../game/rulesCheck");
    const checks = [{ name: "eat", id: "0x01", status: "matches", gates: 3 }];
    useRulesCheck.setState({ state: "verified", checks, run: async () => {} } as never);
    const { RulesMark } = await import("./RulesMark");
    const first = await mount(() => createElement(RulesMark));
    expect(first.host.querySelector(".rules-mark")).not.toBeNull();
    first.close();
    // the next load: the same rules, already seen
    const again = await mount(() => createElement(RulesMark));
    expect(again.host.querySelector(".rules-mark")).toBeNull();
    again.close();
    // a new set of rules is shown again
    useRulesCheck.setState({ checks: [...checks, { name: "play", id: "0x02", status: "matches", gates: 4 }] } as never);
    const changed = await mount(() => createElement(RulesMark));
    expect(changed.host.querySelector(".rules-mark")).not.toBeNull();
    changed.close();
  });
});
