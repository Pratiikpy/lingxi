/**
 * Teaching, as a player teaches: the first Pet School lesson, and a rule built from chips. Each is checked in the
 * save: the pet's lessons grow by one, and the built rule is the one the chips spelled.
 */
import { type Opened, dismiss, expect, hatch, savedPet, sheet, test } from "../fixtures";

type Lesson = { when: Record<string, number[]>; then: { want: number; mood: number }; label?: string };
const lessons = async (p: Opened) =>
  (((await savedPet(p.page)) as { lessons?: Lesson[] } | null)?.lessons ?? []) as Lesson[];

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  // a baby holds one lesson, so each way of teaching gets its own new pet
  test(`teaching: the first Pet School lesson (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player(look);
    const { page } = p;
    await hatch(p, "Pip");
    await sheet(page, "mind");
    const before = (await lessons(p)).length;
    await page.locator(".levels .level-head[data-hint=teach]").first().click();
    await page.locator(".proposal").waitFor();
    await page.locator(".proposal button[data-hint=teach]").click();
    await expect
      .poll(async () => (await lessons(p)).length, { message: "the school lesson is in the pet's save" })
      .toBe(before + 1);
    await expect(page.locator(".levels .level.done").first(), "the level shows as learned").toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`school-${look.lang}-${look.scheme}-${look.size}.png`) });
    await page.keyboard.press("Escape");
    await dismiss(page);
  });

  test(`teaching: a rule built from chips (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player(look);
    const { page, t } = p;
    await hatch(p, "Pip");
    await sheet(page, "mind");
    // "when" starts on an event; pick a want and a mood, preview, teach
    await page.locator("details.build summary").click();
    const builder = page.locator(".builder");
    await builder.waitFor();
    expect(
      await builder.locator(".cond").first().locator(".val.on").count(),
      "the builder starts with one event chosen",
    ).toBe(1);
    const wantRow = builder.locator(".vals").nth(1);
    const moodRow = builder.locator(".vals").nth(2);
    await wantRow.locator(".val").nth(1).click();
    await moodRow.locator(".val").nth(0).click();
    await expect(wantRow.locator(".val").nth(1)).toHaveAttribute("aria-pressed", "true");
    await builder.locator(".btn.primary", { hasText: t("Preview", "预览") }).click();
    await page.locator(".proposal").waitFor();
    const count = (await lessons(p)).length;
    await page.locator(".proposal button[data-hint=teach]").click();
    await expect
      .poll(async () => (await lessons(p)).length, { message: "the built rule is in the pet's save" })
      .toBe(count + 1);
    const built = (await lessons(p)).find((l) => l.label === "my rule");
    expect(built, "the rule taught is the one the chips spelled").toBeTruthy();
    expect(built!.then).toEqual({ want: 1, mood: 0 });
    expect(built!.when.event).toEqual([2]);
    await page.screenshot({ path: test.info().outputPath(`chips-${look.lang}-${look.scheme}-${look.size}.png`) });
    await page.keyboard.press("Escape");
    await dismiss(page);
  });
}
