/**
 * Public diaries, as players publish and read them (Z1, A39). A pet kept on X Layer has its day saved, its owner
 * publishes its diary, and the pet's proof page reads it back and checks it against the chain. A diary longer than its
 * pet has lived on chain is refused by its age, and the game says so.
 */
import { ZERO_HASH, chainAll } from "../../packages/game/src/log";
import { DIARY_FLOOR_WORDS } from "../../services/api/src/diaries";
import { expect, hatch, sheet, test } from "../fixtures";
import { keepOnChain, stored } from "../helpers/browser";

test("a kept pet's diary is published and its proof page reads it back, checked against the chain (en, light, phone)", async ({ player, run }) => {
  test.setTimeout(600_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Pip");
  await sheet(page, "me");
  const petId = await keepOnChain(p, run);
  await page.keyboard.press("Escape");
  // a moment to keep: the pet thinks once when fed, so the day has something in its diary
  await page.locator("button.act[data-hint=feed]").click();
  await page.locator(".sheet .bag-item button", { hasText: "Feed" }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await sheet(page, "me");
  await page.getByRole("button", { name: "Save today on chain" }).click();
  await expect.poll(async () => JSON.parse((await stored(page, "lingxi.chain.v2"))!)[Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!].lastDay, { timeout: 120_000 }).toBe(1);
  await page.getByRole("button", { name: "Publish its diary" }).click();
  await expect(page.locator(".publish-diary [role=status]"), "the diary is kept").toContainText(/Published: \d+ moments, checked against the chain/, { timeout: 60_000 });
  await page.screenshot({ path: test.info().outputPath("diary-published-en-light-phone.png") });

  await page.goto(`${p.web}/verify.html#${petId}`);
  const diary = page.locator(".v-diary");
  // the check waits for the indexer to read the pet's hatching (every 15 s), then passes, fails or says it cannot yet
  await expect(diary, "the diary check comes to a verdict").toContainText(/Its latest day|did not pass|isn't indexed yet/, { timeout: 180_000 });
  const why = (await page.getByTestId("log-result").textContent().catch(() => null)) ?? "(no log check shown)";
  await expect(diary, `the proof page reads the published diary and checks it (its log check said: ${why})`).toContainText("Its latest day, replayed moment by moment", { timeout: 5_000 });
  await page.screenshot({ path: test.info().outputPath("diary-proof-en-light-phone.png"), fullPage: true });
});

test("a diary longer than its pet has lived on chain is refused, and the game says why (zh, dark, desktop)", async ({ player, run }) => {
  test.setTimeout(480_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  const { page } = p;
  await hatch(p, "Momo");
  // a log of more moments than a pet hatched minutes ago can have lived, with its own fingerprint, so the chain agrees
  const words = Array.from({ length: DIARY_FLOOR_WORDS + 500 }, (_, i) => (i * 7919) & 0xffff);
  const hash = chainAll(ZERO_HASH, words);
  await page.addInitScript(
    ({ words, hash }) => {
      if (sessionStorage.getItem("a39.long")) return;
      const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<Record<string, unknown>> };
      save.pets[0] = { ...save.pets[0], pendingLog: words, logHash: hash, logMarks: [[0, (save.pets[0]!.beat as number) - words.length]] };
      localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
      sessionStorage.setItem("a39.long", "1");
    },
    { words, hash },
  );
  await page.reload();
  await page.locator(".stage").waitFor();
  await sheet(page, "me");
  await keepOnChain(p, run);
  await page.getByRole("button", { name: "把今天存上链" }).click();
  await expect.poll(async () => JSON.parse((await stored(page, "lingxi.chain.v2"))!)[Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!].lastDay, { timeout: 120_000 }).toBe(1);
  await page.getByRole("button", { name: "发布日记" }).click();
  await expect(page.locator(".publish-diary [role=status]"), "refused by the pet's age, and said so").toHaveText("这本日记的时刻比Momo在 X Layer 上活过的还多，所以没有收下。", { timeout: 60_000 });
  await page.locator(".publish-diary [role=status]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("diary-too-long-zh-dark-desktop.png") });
});
