/**
 * P9 / R1: a walk counts real steps. On a phone the game reads the motion sensor (game/steps.ts): each rise of the
 * acceleration through a threshold is a step. The browser here is fed the readings a walking phone sends (about two
 * steps a second), and the walk is played as a player would: started from the map, steps counted and shown, ended
 * early, and the steps kept in the walk's summary. A device that sends no readings is said to count minutes instead.
 */
import { type Page } from "@playwright/test";
import { expect, hatch, sheet, test } from "../fixtures";

/** A walking phone's readings: gravity with a bounce on every step, two steps a second, until stopped. */
const walk = (page: Page) =>
  page.evaluate(() => {
    let t = 0;
    const timer = setInterval(() => {
      t += 50;
      // a step every 500 ms: a sharp rise to 13.5 m/s², then back to gravity
      const z = t % 500 < 120 ? 13.5 : 9.81;
      // the reading is set as the event's own property: Object.assign leaves it unset on an Event, and the browser's
      // own empty sensor sends one reading with no values first, which the game rightly ignores
      const e = new Event("devicemotion");
      Object.defineProperty(e, "accelerationIncludingGravity", { value: { x: 0.2, y: 0.3, z } });
      window.dispatchEvent(e);
    }, 50);
    (window as unknown as { stopWalking: () => void }).stopWalking = () => clearInterval(timer);
  });

const stepsShown = async (page: Page): Promise<number> =>
  Number(((await page.locator(".outing-steps b").innerText()) || "0").replace(/[^\d]/g, ""));

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a walk counts the steps a phone's sensor reports (${look.lang}, ${look.scheme}, ${look.size}) (P9, R1)`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await hatch(p, "Momo");
    await sheet(page, "map");
    // the game asks to read motion first (DeviceMotionEvent.requestPermission, as on iOS and in this Chromium); the
    // player says yes
    await p.ctx.grantPermissions(["accelerometer", "gyroscope", "magnetometer"]);
    // the sensor is on before the walk starts, as a phone's is
    await walk(page);
    await page.getByRole("button", { name: p.t("Start walking", "出发散步") }).click();
    await expect(page.locator(".outing-steps"), "steps from the sensor, not minutes").not.toContainText(
      p.t("from minutes", "按分钟算"),
    );
    // about twenty seconds of walking: some forty steps, counted in batches every two seconds
    await expect.poll(() => stepsShown(page), { timeout: 60_000, message: "steps are counted" }).toBeGreaterThan(20);
    const counted = await stepsShown(page);
    expect(counted, "no more steps than the readings held").toBeLessThan(80);
    await page.screenshot({ path: test.info().outputPath(`walk-steps-${look.lang}-${look.scheme}-${look.size}.png`) });
    await page.evaluate(() => (window as unknown as { stopWalking: () => void }).stopWalking());
    await page.getByRole("button", { name: p.t("Head home now", "现在回家") }).click();
    // the walk's summary keeps the steps
    await expect(
      page.getByText(look.lang === "zh" ? /散步回来了：\d+ 分钟，\d+ 步/ : /Back from a walk: \d+ steps/),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
}

test("a device with no step sensor walks by minutes, and says so (en, light, phone) (P9, R1)", async ({ player }) => {
  test.setTimeout(180_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Momo");
  await sheet(page, "map");
  await page.getByRole("button", { name: "Start walking" }).click();
  await expect(page.locator(".outing-steps")).toContainText("from minutes: this device has no step sensor", {
    timeout: 30_000,
  });
});
