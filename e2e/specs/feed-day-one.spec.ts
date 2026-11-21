/**
 * H5b: a new player can feed on day 1. Feed opens the bag's food although the Bag tab waits for day 2 (H5's reveal);
 * the Bag tab itself still asks first. Played as a first visit, with nothing opened in advance.
 */
import { type Opened, expect, hatch, savedPet, test } from "../fixtures";

const food = async (p: Opened) => ((await savedPet(p.page)) as { meters: Record<string, number> } | null)?.meters.food ?? -1;
const tally = (p: Opened, key: string) => p.page.evaluate((k) => (JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as { tally?: Record<string, number> }).tally?.[k] ?? 0, key);

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`Feed works on day 1, and the Bag tab still waits (${look.lang}, ${look.scheme}, ${look.size}) (H5b)`, async ({ player }) => {
    const p = await player({ ...look, firstVisit: true });
    const { page, t } = p;
    await hatch(p, "Pip");
    await expect(page.locator('[data-hint="tab-bag"] .tab-lock'), "the Bag tab is still locked on day 1").toHaveCount(1);

    const before = await food(p);
    await page.locator("button.act[data-hint=feed]").click();
    await page.locator(".sheet .bag-item button", { hasText: t("Feed", "喂食") }).first().click();
    await expect.poll(() => food(p), { message: "fed on day 1: the food meter rises in the save" }).toBeGreaterThan(before);
    await expect.poll(() => tally(p, "CARE:feed"), { message: "the care reaches the tally" }).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    // the Bag tab itself still asks first
    await page.locator('[data-hint="tab-bag"]').click();
    await expect(page.getByRole("button", { name: t("Open everything now", "现在全部打开") })).toBeVisible();
  });
}
