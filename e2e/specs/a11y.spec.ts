/**
 * P5: usable by everyone. axe finds nothing serious on any page or state, in both languages and both themes; the room
 * has one main landmark and one level-one heading; every control a player taps is at least 44 by 44 px; an open sheet
 * keeps the focus inside it and gives it back to the control that opened it.
 */
import { expect, hatch, test } from "../fixtures";
import { seriousFindings, smallTargets } from "../helpers/a11y";

const LOOKS = [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const;
const PAGES = [
  "index.html",
  "verify.html",
  "numbers.html",
  "tree.html",
  "agents.html",
  "handheld.html",
  "circuits.html",
];

for (const look of LOOKS) {
  test(`axe finds nothing serious on any page (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const found: Record<string, unknown> = {};
    for (const page of PAGES) {
      await p.page.goto(`${p.web}/${page}`);
      await p.page.waitForLoadState("networkidle").catch(() => undefined);
      await p.page.waitForTimeout(1_500);
      const f = await seriousFindings(p.page);
      if (f.length) found[page] = f;
    }
    expect(found).toEqual({});
  });

  test(`axe finds nothing serious in the game, the room has its landmark and heading (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await page.goto(`${p.web}/play.html`);
    await page.locator(".hatch").waitFor();
    const found: Record<string, unknown> = {};
    const check = async (where: string) => {
      const f = await seriousFindings(page);
      if (f.length) found[where] = f;
    };
    await check("hatch");
    await hatch(p);
    await check("room");
    await expect(page.locator("main"), "one main landmark in the room").toHaveCount(1);
    await expect(page.locator("h1"), "one level-one heading in the room").toHaveCount(1);
    for (const tab of ["me", "mind"]) {
      await page.locator(`.tab[data-hint=tab-${tab}]`).click();
      await page.locator(".sheet").waitFor();
      await page.waitForTimeout(600);
      await check(`sheet ${tab}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    expect(found).toEqual({});
  });

  test(`every control a player taps is at least 44 px (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await page.goto(`${p.web}/play.html`);
    await page.locator(".hatch").waitFor();
    const small: Record<string, string[]> = {};
    const hatchSmall = await smallTargets(page, ".hatch");
    if (hatchSmall.length) small.hatch = hatchSmall;
    await hatch(p);
    // the one named exception: the level chip on the face's corner has a 34 by 44 px touch area on a phone (any 44 px
    // square there runs off the screen or takes the face's own corner); its action has a full-size twin, the Skills
    // button on the Pet sheet, which is held to 44 px below (BUILD-STATUS 325, decision)
    const roomSmall = (await smallTargets(page, "body")).filter((s) => !s.startsWith("button.lv-chip"));
    if (roomSmall.length) small.room = roomSmall;
    await page.locator(".tab[data-hint=tab-me]").click();
    await page.locator(".sheet").waitFor();
    await page.waitForTimeout(600);
    const sheetSmall = await smallTargets(page, ".sheet");
    if (sheetSmall.length) small.sheet = sheetSmall;
    await expect(
      page.locator(".sheet .lv-skills"),
      "the level chip's full-size twin is on the Pet sheet",
    ).toBeVisible();
    expect(small).toEqual({});
  });

  test(`an open sheet keeps the focus and gives it back (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await hatch(p);
    const opener = page.locator(".tab[data-hint=tab-me]");
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.locator(".sheet").waitFor();
    await page.waitForTimeout(600);
    // forty presses of Tab, then forty of Shift+Tab: the focus never leaves the sheet
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press(key);
        expect(
          await page.evaluate(() => !!document.activeElement?.closest(".sheet")),
          `${key} ${i + 1} stays in the sheet`,
        ).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".sheet")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("data-hint")),
      "the focus is back on the tab that opened it",
    ).toBe("tab-me");
  });
}

/** The elements whose drawn position, size or turn changes over `ms`: what still moves on the page. */
async function moving(page: import("@playwright/test").Page, ms = 1_200): Promise<string[]> {
  // each element is compared with itself (marked on the first read), so a notice that appears meanwhile, such as the
  // rules mark, is a new element and not a shift of every element after it
  const read = () =>
    page.evaluate(() => {
      let next = Number(document.body.dataset.mvNext ?? 0);
      const seen: Record<string, string> = {};
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        if (el.getClientRects().length === 0) continue;
        if (!el.dataset.mv) el.dataset.mv = String(next++);
        seen[el.dataset.mv] =
          `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}|${getComputedStyle(el).transform}`;
      }
      document.body.dataset.mvNext = String(next);
      return seen;
    });
  // three looks, half the time apart: an element moves when it changed in both halves. A value that steps once in the
  // window (a care meter filling as the pet is fed, its bar set at once under reduced motion) is content, not motion
  const first = await read();
  await page.waitForTimeout(ms / 2);
  const middle = await read();
  await page.waitForTimeout(ms / 2);
  const last = await read();
  return Object.entries(last)
    .filter(
      ([id, x]) => first[id] !== undefined && middle[id] !== undefined && first[id] !== middle[id] && middle[id] !== x,
    )
    .map(([, x]) => x);
}

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`with reduced motion asked for, nothing on the page keeps moving (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const found: Record<string, string[]> = {};
    await page.goto(`${p.web}/index.html`);
    await page.waitForTimeout(2_500);
    const landing = await moving(page);
    if (landing.length) found.landing = landing;
    await page.goto(`${p.web}/play.html`);
    await page.locator(".hatch").waitFor();
    await page.waitForTimeout(2_000);
    const hatchScreen = await moving(page);
    if (hatchScreen.length) found.hatch = hatchScreen;
    await hatch(p);
    await page.waitForTimeout(2_000);
    const room = await moving(page);
    if (room.length) found.room = room;
    expect(found).toEqual({});
  });
}
