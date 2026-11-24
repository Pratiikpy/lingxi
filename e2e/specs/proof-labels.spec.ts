/**
 * A57: the proof page labels each check by what it does. A kept pet's memory reads "as saved" until a log replays to
 * it on the page; the step check is named for the random steps it compares and gives its verdict only when it is done;
 * memory reads bit 0 first everywhere; a file that is not a log is said to be one. Once the published diary replays
 * to the saved memory, the memory reads "proven by replay".
 */
import { expect, hatch, sheet, test } from "../fixtures";
import { keepOnChain, stored } from "../helpers/browser";

test("the proof page claims only what it has checked (en, light, phone; zh, dark, desktop)", async ({
  player,
  run,
}) => {
  test.setTimeout(600_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Pip");
  await sheet(page, "me");
  const petId = await keepOnChain(p, run);

  await page.goto(`${p.web}/verify.html#${petId}`);
  const saved = page.locator(".v-tag").first();
  await expect(saved, "before any log is replayed, the memory is only as saved").toHaveText("Memory as saved", {
    timeout: 120_000,
  });
  await expect(page.getByText("Proven once a log replays to it")).toBeVisible();

  // a file that is not a log
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "not-a-log.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') });
  await expect(page.getByTestId("log-result")).toHaveText("This file isn't a Lingxi log: it could not be read as one.");

  // the step check counts while it runs, and gives its verdict when done
  await page.getByRole("button", { name: "Compare 32 random steps of its circuit" }).click();
  await expect(page.getByText(/of 32 compared/)).toBeVisible();
  await expect(
    page.locator(".v-ok", { hasText: "All 32 steps match: at its saved memory and at 31 random memories" }),
  ).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".v-table thead"), "the table says which bit comes first").toContainText(
    "memory, bit 0 first",
  );
  // the first step is at its saved memory, written as the saved state above writes it
  const savedBits = (await page.locator("dd .mono[title='memory, bit 0 first']").textContent())!.trim();
  await expect(page.locator(".v-table tbody tr").first().locator("td").nth(1)).toHaveText(savedBits);
  await page.screenshot({ path: test.info().outputPath("proof-labels-en-light-phone.png"), fullPage: true });

  // the owner saves a day and publishes the diary; the page replays it, and only then calls the memory proven
  await page.goto(`${p.web}/play.html`);
  await page.locator(".stage").waitFor();
  await page.locator("button.act[data-hint=feed]").click();
  await page.locator(".sheet .bag-item button", { hasText: "Feed" }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await sheet(page, "me");
  await page.getByRole("button", { name: "Save today on chain" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await stored(page, "lingxi.chain.v2"))!)[
          Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!
        ].lastDay,
      { timeout: 120_000 },
    )
    .toBe(1);
  await page.getByRole("button", { name: "Publish its diary" }).click();
  await expect(page.locator(".publish-diary [role=status]")).toContainText(/Published/, { timeout: 60_000 });

  const z = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  await z.page.goto(`${z.web}/verify.html#${petId}`);
  await expect(z.page.locator(".v-diary"), "the diary replays to the saved memory").toContainText(
    /最近一天|Its latest day|没有通过|isn't indexed yet|还没被索引/,
    { timeout: 200_000 },
  );
  await expect(z.page.locator(".v-tag").first(), "and only then is the memory called proven").toHaveText(
    "记忆，由重放证明",
    { timeout: 30_000 },
  );
  await z.page.screenshot({ path: test.info().outputPath("proof-labels-zh-dark-desktop.png") });
});
