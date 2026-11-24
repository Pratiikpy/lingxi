/**
 * A71: the page asks its own server about each contract's source, never Sourcify directly, so a Sourcify outage is
 * words on the page and not console errors. The suite's server asks a stand-in that gives Sourcify's recorded answers.
 */
import { expect, sheet, hatch, test } from "../fixtures";
import { reach } from "../helpers/chain";

for (const look of [
  {
    lang: "en",
    scheme: "light",
    size: "phone",
    verified: "✓ source verified",
    down: "? Sourcify unreachable",
    extrasDown: "Sourcify could not be reached",
  },
  {
    lang: "zh",
    scheme: "dark",
    size: "desktop",
    verified: "✓ 源码已验证",
    down: "? 连不上 Sourcify",
    extrasDown: "连不上 Sourcify",
  },
] as const) {
  test(`source checks come through the page's own server, and an outage is said in words (${look.lang}, ${look.scheme}, ${look.size}) (A71)`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    const direct: string[] = [];
    page.on("request", (r) => new URL(r.url()).hostname.endsWith("sourcify.dev") && direct.push(r.url()));

    // the contract table: the registry (mainnet's, kept on the fork) reads as Sourcify recorded it
    await page.goto(`${p.web}/verify.html#contracts`);
    const table = page.locator("#contracts");
    await expect(table.locator("tbody tr").first().locator("td:last-child")).toContainText(look.verified, {
      timeout: 60_000,
    });

    // Sourcify down: the server says so, the page says so, and the browser logs nothing (the fixture checks)
    await page.route(
      (u) => u.pathname.startsWith("/api/sourcify/"),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, address: route.request().url().split("/").pop(), state: "unreachable" }),
        }),
    );
    await page.reload();
    await expect(table.locator("tbody tr").first().locator("td:last-child")).toContainText(look.down.slice(2), {
      timeout: 60_000,
    });
    // and the summary says none could be checked, never that none is verified
    await expect(table.locator("[role=status]")).toContainText(
      look.lang === "zh"
        ? "现在连不上 Sourcify，所以暂时核对不了这些合约的源码"
        : "Sourcify can't be reached just now, so the contracts' source can't be checked",
    );
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`sourcify-down-${look.lang}-${look.scheme}-${look.size}.png`),
    });

    // the game's Extras panel words it the same way
    await page.goto(`${p.web}/play.html`);
    await hatch(p, "Pip");
    await sheet(page, "me");
    await expect(await reach(page, ".chainpanel.extras")).toContainText(look.extrasDown, { timeout: 60_000 });
    expect(direct, "the browser never asked Sourcify itself").toEqual([]);
  });
}
