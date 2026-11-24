/**
 * A99: code reads as code in both languages. On a Chinese page the browser's generic monospace is a CJK serif, which
 * draws straight quotes curly and spaces unevenly, so the agents page's calls looked wrong though they copied right.
 * Every code element uses the game's monospace stack (`--mono`), whose first faces are real monospace fonts.
 */
import { expect, test } from "../fixtures";

for (const look of [
  { lang: "zh", scheme: "dark", size: "phone" },
  { lang: "en", scheme: "light", size: "desktop" },
] as const) {
  test(`the agents page's calls are set in a monospace face (${look.lang}, ${look.scheme}, ${look.size}) (A99)`, async ({
    player,
  }) => {
    test.setTimeout(120_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await page.goto(`${p.web}/agents.html`);
    const pre = page.locator("pre").first();
    await pre.waitFor();
    const family = await pre.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family, "the monospace stack, never the browser's generic one alone").toMatch(/^ui-monospace,/);
    // a straight quote and a letter take the same width, as in any monospace face
    const widths = await pre.evaluate((el) => {
      const probe = document.createElement("span");
      el.appendChild(probe);
      const width = (t: string) => ((probe.textContent = t), probe.getBoundingClientRect().width);
      const w = { quote: width("''''''''''"), letter: width("mmmmmmmmmm") };
      probe.remove();
      return w;
    });
    expect(Math.abs(widths.quote - widths.letter), "quotes and letters are equally wide").toBeLessThan(0.5);
    await pre.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`code-font-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
