/**
 * A64: the saves goal says how it is counted, the daily cap included: a wallet's saves count for at most as many pets
 * as a player keeps each day, so hatching more free pets moves nothing. The numbers page shows it in both languages.
 */
import { expect, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", said: "at most 8 a day for one wallet (the most pets a player keeps)" },
  { lang: "zh", scheme: "dark", size: "desktop", said: "一个钱包一天最多算 8 次（一个玩家最多养的宠物数）" },
] as const) {
  test(`the saves goal says a wallet counts at most 8 a day (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(180_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await page.goto(`${p.web}/numbers.html`);
    const said = page.getByText(look.said);
    await expect(said, "the saves goal's method names the daily cap").toBeVisible({ timeout: 60_000 });
    await said.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`goal-saves-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
