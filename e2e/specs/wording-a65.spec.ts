/**
 * A65: wording that said more than was true. The landing says when pet #1 was hatched rather than that it "lives" on
 * X Layer; the live-numbers page, which says it is refreshed every minute, now is; the proof page's times name their
 * zone.
 */
import { expect, hatch, sheet, test } from "../fixtures";
import { forkOf, keepOnChain } from "../helpers/chain";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", landing: "pet #1 was hatched there on 15 November", zone: /GMT|UTC/ },
  { lang: "zh", scheme: "dark", size: "desktop", landing: "1 号宠物 11 月 15 日在 X Layer 上孵化", zone: /GMT|UTC/ },
] as const) {
  test(`the landing, the numbers page and the proof page say only what holds (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;

    await page.goto(`${p.web}/`);
    const line = page.getByText(look.landing);
    await line.scrollIntoViewIfNeeded();
    await expect(line).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`landing-pet1-${look.lang}-${look.scheme}-${look.size}.png`),
    });

    // the numbers page reads them again each minute while it is in view
    const reads: number[] = [];
    page.on("request", (r) => new URL(r.url()).pathname === "/api/numbers" && reads.push(Date.now()));
    await page.clock.install();
    await page.goto(`${p.web}/numbers.html`);
    await expect.poll(() => reads.length, { message: "read on opening" }).toBeGreaterThanOrEqual(1);
    const first = reads.length;
    await page.clock.fastForward("01:01");
    await expect.poll(() => reads.length, { message: "and again a minute later" }).toBeGreaterThan(first);
  });

  test(`the proof page's times name their zone (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
    run,
  }) => {
    test.setTimeout(420_000);
    await forkOf(run);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await hatch(p, "Kiri");
    await sheet(page, "me");
    const { petId } = await keepOnChain(page);
    await page.goto(`${p.web}/verify.html#${petId}`);
    const when = page.locator(".v-history .v-when").first();
    await expect(when, "the hatch's time, with its zone").toHaveText(look.zone, { timeout: 180_000 });
    await when.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`proof-times-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
