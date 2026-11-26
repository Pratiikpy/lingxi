/**
 * P9 / R1: the game as a Telegram Mini App. A real Telegram client needs an account and the bot (Prateek's); what the
 * game itself does with Telegram is checked here. Telegram's own script is kept from loading and a stand-in WebApp
 * object, with a launch's initData, records every call. The game must: fill the screen, say it is ready and turn off
 * swipe-to-close; take Telegram's theme and language; show Telegram's back button while a sheet is open, its press
 * closing the sheet; and answer a tap with Telegram's haptics (game/telegram.ts, core.telegram.org/bots/webapps).
 */
import { expect, hatch, sheet, test } from "../fixtures";

type Calls = Array<[string, ...unknown[]]>;

test("inside Telegram the game takes its theme and language, its back button and its haptics (zh, dark, phone) (P9, R1)", async ({
  player,
}) => {
  test.setTimeout(180_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "phone" });
  const { page } = p;
  // Telegram's script is not fetched: the stand-in below is Telegram for this page
  await page.route(/telegram\.org\/js\/telegram-web-app\.js/, (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.addInitScript(() => {
    const calls: Array<[string, ...unknown[]]> = [];
    let back: (() => void) | null = null;
    const rec =
      (name: string) =>
      (...a: unknown[]) =>
        void calls.push([name, ...a]);
    (window as unknown as { tgCalls: typeof calls; tgBack: () => void }).tgCalls = calls;
    (window as unknown as { tgBack: () => void }).tgBack = () => back?.();
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: "query_id=AAE&user=%7B%22id%22%3A1%7D&auth_date=1795600000&hash=0",
        initDataUnsafe: { user: { language_code: "zh-hans" } },
        version: "8.0",
        colorScheme: "dark",
        isVersionAtLeast: () => true,
        ready: rec("ready"),
        expand: rec("expand"),
        disableVerticalSwipes: rec("disableVerticalSwipes"),
        setHeaderColor: rec("setHeaderColor"),
        setBackgroundColor: rec("setBackgroundColor"),
        openLink: rec("openLink"),
        openTelegramLink: rec("openTelegramLink"),
        onEvent: rec("onEvent"),
        BackButton: {
          show: rec("BackButton.show"),
          hide: rec("BackButton.hide"),
          onClick: (cb: () => void) => {
            back = cb;
            calls.push(["BackButton.onClick"]);
          },
          offClick: (cb: () => void) => {
            if (back === cb) back = null;
            calls.push(["BackButton.offClick"]);
          },
        },
        HapticFeedback: {
          impactOccurred: rec("impactOccurred"),
          notificationOccurred: rec("notificationOccurred"),
          selectionChanged: rec("selectionChanged"),
        },
      },
    };
  });
  await hatch(p, "Momo");
  const calls = () => page.evaluate(() => (window as unknown as { tgCalls: Calls }).tgCalls);
  const names = async () => (await calls()).map((c) => c[0]);

  // the start: full height, ready, no swipe-to-close; Telegram's dark theme and its colours matched to the page
  expect(await names()).toEqual(expect.arrayContaining(["expand", "ready", "disableVerticalSwipes"]));
  await expect(page.locator("html")).toHaveClass(/in-telegram/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(async () => (await calls()).find((c) => c[0] === "setHeaderColor")?.[1]).toMatch(/^#[0-9a-f]{6}$/);
  // Telegram's language (zh-hans) is the game's
  await expect(page.locator(".tab[data-hint=tab-map]")).toContainText("地图");

  // a sheet open: Telegram's back button shows, and pressing it closes the sheet and hides the button
  await sheet(page, "map");
  await expect.poll(names).toContain("BackButton.show");
  await page.evaluate(() => (window as unknown as { tgBack: () => void }).tgBack());
  await expect(page.locator(".sheet"), "Telegram's back button closes the sheet").toHaveCount(0);
  await expect.poll(names).toContain("BackButton.hide");

  // a tap on a button answers with Telegram's haptics
  await page.locator(".act[data-hint=clean]").click();
  await expect
    .poll(async () => (await calls()).some((c) => c[0] === "impactOccurred" || c[0] === "notificationOccurred"))
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath("telegram-zh-dark-phone.png") });
});
