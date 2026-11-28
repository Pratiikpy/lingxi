// @vitest-environment happy-dom
/**
 * R66: a community goal's keepsake is claimed only once the goal is finished (the server signs a voucher for a
 * complete goal and a wallet that helped, services/api/src/voucher.ts). The shop offered Claim on every keepsake while
 * every goal stood open at 0, and the tap led into a wallet and ended "not finished". Claim now waits for the goal,
 * says why in the player's language, and never asks the wallet for a claim that cannot be signed.
 */
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAIN_DECOR, GOAL_BY_ID } from "@lingxi/world";
import { leave, show, visit } from "../game/testGame";

afterEach(() => {
  leave();
  document.body.innerHTML = "";
});

const piece = CHAIN_DECOR.find((p) => p.chain?.kind === "keepsake" && p.chain.goal === "g1")!;
const goal = GOAL_BY_ID.g1!;

type Report = { state: "upcoming" | "open" | "complete" | "ended"; total: number; mine: number };

async function card(lang: "en" | "zh", report: Report | null) {
  await visit({ at: Date.UTC(2026, 10, 28, 9) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    clearRect: () => {},
    fillRect: () => {},
    drawImage: () => {},
  } as never);
  const { useGoals } = await import("../game/goals");
  const { useLang } = await import("../i18n");
  const { KeepsakeCard } = await import("./ItemShop");
  useLang.setState({ lang });
  useGoals.setState({
    status: report ? "ready" : "loading",
    reports: report ? { g1: { id: "g1", tiers: [], contributors: report.mine ? 1 : 0, top: [], ...report } } : {},
  });
  const onClaim = vi.fn();
  const view = await show(
    createElement(KeepsakeCard, { piece, goal, have: false, busy: null, canClaim: true, onClaim }),
  );
  const button = document.querySelector<HTMLButtonElement>(".itemshop-card button")!;
  const why = document.getElementById(button.getAttribute("aria-describedby") ?? "");
  return { button, why: why?.textContent ?? null, onClaim, view };
}

describe("a keepsake's Claim waits for its goal (R66)", () => {
  it("while the goal is open at 0, Claim is unavailable, says why, and asks no wallet", async () => {
    const { button, why, onClaim, view } = await card("en", { state: "open", total: 0, mine: 0 });
    expect(button.textContent).toBe("Claim");
    expect(button.disabled).toBe(true);
    expect(why).toContain("Opens when everyone together finishes the goal");
    expect(why).toContain(`0 of ${goal.target}`);
    await act(async () => button.click());
    expect(onClaim).not.toHaveBeenCalled();
    view.unmount();
  });

  it("in Chinese too, and for a goal not started, one that ended short, and one not yet read", async () => {
    const zh = await card("zh", { state: "open", total: 0, mine: 0 });
    expect(zh.button.disabled).toBe(true);
    expect(zh.why).toContain("大家一起完成这个目标后才能领取");
    zh.view.unmount();
    const upcoming = await card("en", { state: "upcoming", total: 0, mine: 0 });
    expect(upcoming.button.disabled).toBe(true);
    expect(upcoming.why).toBe("This goal hasn't started yet. Its keepsake opens when everyone together finishes it.");
    upcoming.view.unmount();
    const ended = await card("zh", { state: "ended", total: 3, mine: 1 });
    expect(ended.button.disabled).toBe(true);
    expect(ended.why).toBe("这个目标没完成就结束了，所以它的纪念品领不了。");
    ended.view.unmount();
    const unread = await card("en", null);
    expect(unread.button.disabled).toBe(true);
    expect(unread.why).toBe("Opens when everyone together finishes the goal.");
    unread.view.unmount();
  });

  it("a finished goal opens Claim, and says whether this player's wallet helped", async () => {
    const helped = await card("en", { state: "complete", total: goal.target, mine: 4 });
    expect(helped.button.disabled).toBe(false);
    expect(helped.why).toBe("Finished, and your wallet helped: claim it once, for the network fee.");
    await act(async () => helped.button.click());
    expect(helped.onClaim).toHaveBeenCalledTimes(1);
    helped.view.unmount();
    const other = await card("zh", { state: "complete", total: goal.target, mine: 0 });
    expect(other.button.disabled).toBe(false);
    expect(other.why).toBe("已经完成了。用出过力的钱包领取，只需网络费。");
    other.view.unmount();
  });
});
