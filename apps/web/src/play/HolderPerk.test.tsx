// @vitest-environment happy-dom
/**
 * H9: the holder perks are named on the hatch screen, a holder sees what their wallet gives, and a non-holder sees what
 * the perks are and that nothing was taken.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

const wallet = "0x00000000000000000000000000000000000000aa";

async function open(lang: "en" | "zh" = "en") {
  await visit({ at: Date.UTC(2026, 10, 22, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  const { useHoldings } = await import("../game/holders");
  const { HolderPerkNote } = await import("./HolderPerk");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(HolderPerkNote)));
  const text = () => host.textContent ?? "";
  const hold = async (h: {
    test1?: boolean;
    rig?: boolean;
    bem?: boolean;
    fab?: boolean;
    snapshot?: boolean;
    pinClaimed?: boolean;
  }) =>
    act(async () =>
      useHoldings.getState().set({ wallet, test1: false, rig: false, bem: false, fab: false, at: 0, ...h }),
    );
  return { host, text, hold, close: () => (act(() => root.unmount()), host.remove()) };
}

describe("the holder perks on the hatch screen (H9)", () => {
  it("tells a wallet in the snapshot that a pin waits, though it holds no BEM or FAB today (C3)", async () => {
    const s = await open();
    await s.hold({ snapshot: true });
    expect(s.text()).toMatch(/you held BEM or FAB at the snapshot \(block 76,052,000\)/);
    expect(s.text()).toMatch(/a free holder pin, to claim in the Pet tab once your pet has hatched/);
    expect(s.text()).not.toMatch(/nothing to claim/);
    s.close();
  });

  it("says a pin already claimed is claimed, and promises no second one (C3)", async () => {
    const s = await open();
    await s.hold({ test1: true, pinClaimed: true });
    expect(s.text()).toMatch(/this wallet's holder pin is already claimed/);
    expect(s.text()).not.toMatch(/a free holder pin, to claim/);
    s.close();
  });

  it("names the perks and who gets them before any check, and the check signs nothing", async () => {
    const s = await open();
    expect(s.text()).toMatch(/A TapeCode-Test1 gilds your eggs/);
    // C3: BEM and FAB give the pin by the snapshot, never by today's balance
    expect(s.text()).toMatch(
      /Test1 and Rig holders, and wallets that held BEM or FAB at the snapshot \(block 76,052,000\), get a free pin/,
    );
    expect(s.text()).not.toMatch(/Test1, Rig, BEM and FAB holders get a free pin/);
    expect(s.text()).toMatch(/Checking reads your wallet only: nothing to sign, nothing to pay/);
    expect(s.host.querySelector(".hatch-perk-btn")!.textContent).toBe("Check my wallet");
    s.close();
  });

  it("tells a Test1 holder their eggs are gilded and a pin waits in the Pet tab", async () => {
    const s = await open();
    await s.hold({ test1: true, bem: true });
    const items = Array.from(s.host.querySelectorAll(".hatch-perk-list li")).map((li) => li.textContent);
    expect(items).toEqual([
      "your eggs hatch from a gilded shell (you hold a TapeCode-Test1)",
      "a free holder pin, to claim in the Pet tab once your pet has hatched",
      "the BEM holder mark",
    ]);
    s.close();
  });

  it("tells a wallet with nothing that nothing changed and nothing was spent, and names the snapshot way still open", async () => {
    const s = await open();
    await s.hold({});
    expect(s.text()).toMatch(/nothing to claim; nothing changed and nothing was spent/);
    expect(s.text()).toMatch(/0\.1 BEM or 10 FAB at block 76,052,000/);
    s.close();
  });

  it("says it in Chinese", async () => {
    const s = await open("zh");
    expect(s.text()).toMatch(/镀金/);
    expect(s.text()).toMatch(/不用签名，不花钱/);
    await s.hold({ rig: true });
    expect(s.text()).toMatch(/矿机间/);
    expect(s.text()).toMatch(/宠物孵出来后在宠物页领取/);
    s.close();
  });

  it("is on the hatch screen", async () => {
    await visit({ at: Date.UTC(2026, 10, 22, 9) });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => undefined,
      clearRect: () => undefined,
      drawImage: () => undefined,
    })) as never);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { Hatch } = await import("./Hatch");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Hatch, { onHatch: () => undefined })));
    expect(host.querySelector(".hatch-perk")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
