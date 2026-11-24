/**
 * A124 and A125, the pet's sheet on a phone. Its level line (the level, its bar and the skills button) pushed the sheet
 * 32 px wider than the screen, so it slid sideways and cut its labels; and the skills sheet, opened from that line,
 * opened beneath the pet's sheet, so tapping "Skills" seemed to do nothing.
 */
import { expect, hatch, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", skills: "'s skills" },
  { lang: "zh", scheme: "dark", size: "phone", skills: "的技能" },
] as const) {
  test(`the pet's sheet fits a phone, and Skills opens on top of it (${look.lang}, ${look.scheme}, ${look.size}) (A124, A125)`, async ({
    player,
  }) => {
    test.setTimeout(180_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await page.addInitScript(() => localStorage.setItem("lingxi.reveal.v1", "1"));
    await hatch(p, "Kiri");
    await page.locator(".tab[data-hint=tab-me]").click();
    await page.locator(".sheet").waitFor();
    const skills = page.locator(".lv-skills");
    // the pet's details are drawn as the sheet is scrolled to them
    for (let i = 0; i < 120 && !(await skills.count()); i++) {
      await page.mouse.move(180, 600);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(120);
    }
    await skills.waitFor({ state: "attached", timeout: 30_000 });
    await skills.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    const body = await page
      .locator(".sheet .sbody")
      .first()
      .evaluate((b) => ({ wide: b.scrollWidth, box: b.clientWidth, left: b.scrollLeft }));
    expect(body.wide, "nothing in the pet's sheet is wider than the sheet").toBeLessThanOrEqual(body.box);
    expect(body.left, "and it has not slid sideways").toBe(0);
    await page.screenshot({ path: test.info().outputPath(`pet-sheet-${look.lang}-${look.scheme}.png`) });
    await skills.click();
    const title = page.getByRole("heading", { name: `Kiri${look.skills}` });
    await expect(title, "the skills sheet opens, on top: its title is what the player sees there").toBeVisible();
    const top = await page.evaluate(() => {
      const h = [...document.querySelectorAll(".sheet h2")]
        .find((x) => /skills|技能/.test(x.textContent ?? ""))!
        .getBoundingClientRect();
      const at = document.elementFromPoint(h.left + 4, h.top + h.height / 2);
      return at?.closest(".sheet")?.querySelector("h2")?.textContent ?? "";
    });
    expect(top, "the topmost thing at the skills title is the skills sheet").toMatch(/skills|技能/);
    await page.screenshot({ path: test.info().outputPath(`skills-on-top-${look.lang}-${look.scheme}.png`) });
  });
}
