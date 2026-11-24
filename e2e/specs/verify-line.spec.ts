/**
 * A18: the proof page says when a pet's recorded line is not its saved state's. On the fork (X Layer mainnet after
 * every deployment), pet #2 was hatched as the gentle line with a bold pet's state; pet #3 is the same pet hatched
 * right, and its page says nothing of the kind.
 */
import { expect, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", recorded: "gentle", state: "bold" },
  { lang: "zh", scheme: "dark", size: "desktop", recorded: "温柔", state: "勇敢" },
] as const) {
  test(`the proof page says a pet's recorded line differs from its state (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await page.goto(`${p.web}/verify.html#2`);
    await page.locator(".v-card").first().waitFor({ timeout: 90_000 });
    const note = page.locator(".v-line");
    await expect(note, "pet #2's page says its line").toBeVisible({ timeout: 60_000 });
    await expect(note).toContainText(look.recorded);
    await expect(note).toContainText(look.state);
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`verify-line-${look.lang}-${look.scheme}-${look.size}.png`) });

    await page.goto(`${p.web}/verify.html#3`);
    await page.reload();
    await page.locator(".v-picture").first().waitFor({ timeout: 90_000 });
    await expect(page.locator(".v-line"), "pet #3, hatched right, has no such note").toHaveCount(0);
  });
}
