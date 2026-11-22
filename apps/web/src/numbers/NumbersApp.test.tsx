// @vitest-environment happy-dom
/**
 * C2: the numbers page says whose activity its figures are. While every pet and sale is the team's own, it says so
 * plainly; once players come, each figure shows the team's share apart; earnings from the team's own test purchases are
 * never called income; and the free keep says it is switched off while it is.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEAM = "0xA551feD6f2Ab35d509A71B74D5E9F38742E0aaD8";
const RELAYER = "0x20A016fbeAf847C47eC32d7e759365a51a8385A1";

function numbers(o: { playerPets?: number; playerCopies?: number; fromTeam?: string } = {}) {
  const pp = o.playerPets ?? 0;
  const pc = o.playerCopies ?? 0;
  return {
    ok: true,
    head: 1_000,
    at: Date.UTC(2026, 10, 22, 12),
    pets: { hatched: 3 + pp, children: 0, daysSaved: 3, savedLast24h: 0, hatchers: 1 + (pp ? 1 : 0), nextPetId: 4 + pp, indexedTo: 1_000, byTeam: { hatched: 3, children: 0, saves: 3, hatchers: 1, savedLast24h: 0 } },
    team: { wallets: [TEAM, RELAYER], hidden: 1 },
    outfits: {
      okb: { copies: 1 + pc, paid: String(1_000_000_000_000_000n * BigInt(1 + pc)), sales: 1 + pc, indexedTo: 1_000, byTeam: { copies: 1, paid: "1000000000000000" }, selfBuys: { copies: 0, paid: "0" }, byPlayers: { copies: pc, paid: String(1_000_000_000_000_000n * BigInt(pc)), buyers: pc ? 1 : 0 } },
      bem: null,
    },
    burned: { market: "0", breeding: "0", total: "0" },
    week: { since: 0, hatched: 2, children: 0, saves: 2, petsSaved: 2, hatchers: 1, circuits: null, byTeam: { hatched: 2, children: 0, saves: 2, petsSaved: 2, hatchers: 1 } },
    kept: { own: 3, sponsored: 0, other: 0, sponsors: [RELAYER], sponsorOn: false },
    circuits: null,
    earned: { okb: "30000000000000", feeBps: 300, treasury: TEAM, toProject: true, indexedTo: 1_000, fromTeam: o.fromTeam ?? "30000000000000" },
    extras: null,
    pins: 0,
    usedByOthers: null,
    contracts: {},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(body: unknown, lang: "en" | "zh" = "en") {
  vi.stubGlobal("fetch", async (url: string) => ({ ok: true, json: async () => (String(url).includes("/api/numbers") ? body : { ok: false }) }));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  const { NumbersApp } = await import("./NumbersApp");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(NumbersApp)));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return { text: () => host.textContent ?? "", close: () => act(() => root.unmount()) };
}

describe("whose activity the numbers are (C2)", () => {
  it("says plainly that every figure is the team's own testing while it is, and names the team's wallets", async () => {
    const p = await open(numbers());
    expect(p.text()).toMatch(/So far every figure here is the team's own testing: nobody outside the team has hatched a pet or bought an outfit yet/);
    expect(p.text()).toMatch(/The team's wallets: 0xA551…aaD8, 0x20A0…85A1, and 1 more kept private, counted with them\./);
    expect(p.text()).toMatch(/All of it the team's own testing/);
    p.close();
  });

  it("never calls the team's own test purchase income, and says the free keep is off", async () => {
    const p = await open(numbers());
    expect(p.text()).toMatch(/All of it from the team's own test purchases: the team paying itself, not income\./);
    expect(p.text()).toMatch(/Switched off for now: Lingxi is not keeping pets for free at the moment\./);
    p.close();
  });

  it("once players come, shows each figure's team share apart and who bought, by distinct player wallets", async () => {
    const p = await open(numbers({ playerPets: 2, playerCopies: 3, fromTeam: "10000000000000" }));
    expect(p.text()).toMatch(/Players outside the team have hatched 2 pets and bought 3 outfit copies/);
    expect(p.text()).toMatch(/The team's own: 3 · everyone else: 2/);
    expect(p.text()).toMatch(/Bought by 1 player wallet outside the team: 3 \(0\.003 OKB\) · by the team's own wallets: 1 · creators or sellers buying their own: 0/);
    expect(p.text()).toMatch(/From players: 0\.00002 OKB · from the team's own test purchases: 0\.00001 OKB/);
    p.close();
  });

  it("says it in Chinese", async () => {
    const p = await open(numbers(), "zh");
    expect(p.text()).toMatch(/到目前为止，这里的每个数字都是团队自己的测试/);
    expect(p.text()).toMatch(/另有 1 个不公开，同样计入团队/);
    expect(p.text()).toMatch(/全部来自团队自己的测试购买：团队付给自己，不是收入/);
    expect(p.text()).toMatch(/目前已关闭：灵犀暂时不免费代为上链/);
    p.close();
  });
});
