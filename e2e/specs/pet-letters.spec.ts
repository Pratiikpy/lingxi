/**
 * H13: a letter between two players' pets over TapeRelay, through the real path, on TapeRelay's live nodes. Each player
 * opens Pet letters once (their relay identity is made in the browser and published), Lulu visits Kiri's home, Kiri's
 * player sends Lulu a heart (the friendship records each other's letters address and approves it on the relay), then
 * each pet writes and the other reads the letter, marked as checked on arrival. Two isolated browsers: an English phone
 * in light and a Chinese desktop in dark.
 */
import { type Page } from "@playwright/test";
import { expect, dismiss, hatch, test } from "../fixtures";
import { stored } from "../helpers/browser";
import { spotFor, tapVisitor } from "../helpers/room";

/** Opens the mailbox on its pet letters tab. */
async function petLetters(page: Page, zh: boolean): Promise<void> {
  await page.locator(".mail-btn").click();
  await page.getByRole("tab", { name: zh ? "宠物的信" : "Pet letters" }).click();
  await page.locator(".pet-letters").waitFor();
}

/** Waits until this player's letters identity exists (made and published on a relay node). */
const identity = (page: Page) =>
  page.waitForFunction(
    () =>
      /^key:0x[0-9a-f]{40}@relay[1-5]\.taperelay\.com$/.test(
        (JSON.parse(localStorage.getItem("lingxi.letters.v1") ?? "{}") as { account?: string }).account ?? "",
      ),
    undefined,
    { timeout: 60_000 },
  );

// R59: this test crosses TapeRelay's live nodes (an alpha network outside this repo); once in 40 CI runs a letter the
// relay had accepted took longer than its 90 s to arrive. One retry absorbs such a hiccup; the run reports it as flaky,
// so it is seen, and every check below is unchanged
test.describe.configure({ retries: 1 });

test("a letter goes from one pet to a friend's pet over TapeRelay, and one comes back (H13)", async ({ player }) => {
  test.setTimeout(600_000);
  const a = await player({ lang: "en", scheme: "light", size: "phone" });
  const b = await player({ lang: "zh", scheme: "dark", size: "desktop", wallet: 1 });
  await hatch(a, "Kiri");
  await hatch(b, "Lulu");
  // each opens Pet letters once: the identity is made on first need
  await petLetters(a.page, false);
  await identity(a.page);
  await expect(a.page.locator(".pet-letters"), "no friend to write to yet, and it says how one comes").toContainText(
    "meet their pet in a live room",
  );
  await a.page.screenshot({ path: test.info().outputPath("letters-empty-en-light-phone.png") });
  await a.page.keyboard.press("Escape");
  await petLetters(b.page, true);
  await identity(b.page);
  await b.page.keyboard.press("Escape");

  // Lulu visits Kiri's home; Kiri's player sends Lulu a heart, a moment both pets keep
  const idA = (await stored(a.page, "lingxi.player.v1"))!;
  const idB = (await stored(b.page, "lingxi.player.v1"))!;
  await b.page.goto(`${b.web}/play.html?visit=${idA}`);
  await b.page.locator(".stage").waitFor();
  await dismiss(b.page);
  const card = a.page.locator(".visitor-card");
  for (let tries = 0; tries < 20 && !(await card.isVisible()); tries++) {
    await tapVisitor(a.page, spotFor(idB), { nth: tries });
    await a.page.waitForTimeout(400);
  }
  await expect(card, "Lulu is picked in Kiri's room").toBeVisible();
  await card.getByRole("button", { name: "Heart" }).click();
  // each side has the other's address in its letters book once the friendship and the address meet
  await a.page.waitForFunction(
    (id) =>
      !!(JSON.parse(localStorage.getItem("lingxi.letters.v1") ?? "{}") as { book?: Record<string, string> }).book?.[id],
    idB,
    { timeout: 60_000 },
  );
  await b.page.waitForFunction(
    (id) =>
      !!(JSON.parse(localStorage.getItem("lingxi.letters.v1") ?? "{}") as { book?: Record<string, string> }).book?.[id],
    idA,
    { timeout: 60_000 },
  );

  // Kiri writes to Lulu
  await petLetters(a.page, false);
  const write = a.page.locator(".pl-write");
  await expect(write.locator("select")).toContainText("Lulu");
  await write.locator("textarea").fill("Dear Lulu, thank you for visiting. Come again soon!");
  await write.getByRole("button", { name: "Send the letter" }).click();
  await expect(write.locator(".pl-ok")).toHaveText("Sent to Lulu.", { timeout: 60_000 });
  await expect(a.page.locator(".pl-letter.is-out").first()).toContainText(/on its way|delivered/, { timeout: 30_000 });

  // Lulu's player opens the letters and reads it, checked on arrival
  await b.page.goto(`${b.web}/play.html`);
  await b.page.locator(".stage").waitFor();
  await petLetters(b.page, true);
  const got = b.page.locator(".pl-letter.is-in").first();
  await expect(got).toContainText("Dear Lulu, thank you for visiting. Come again soon!", { timeout: 90_000 });
  await expect(got).toContainText("Kiri写给Lulu");
  await expect(got).toContainText("已封好并签名，收到时核对过");
  await b.page.screenshot({ path: test.info().outputPath("letters-received-zh-dark-desktop.png") });

  // and Lulu writes back, in Chinese
  const reply = b.page.locator(".pl-write");
  await reply.locator("textarea").fill("亲爱的Kiri，谢谢你的心！下次来我家玩。");
  await reply.getByRole("button", { name: "寄出" }).click();
  await expect(reply.locator(".pl-ok")).toHaveText("已寄给Kiri。", { timeout: 60_000 });

  // Kiri's letters fill in without a reload: the inbox is read every 30 seconds while the game is open, or by push
  const back = a.page.locator(".pl-letter.is-in").first();
  await expect(back).toContainText("亲爱的Kiri，谢谢你的心！下次来我家玩。", { timeout: 90_000 });
  await expect(back).toContainText("Sealed and signed, checked on arrival");
  await expect(a.page.locator(".pl-letter.is-out").first()).toContainText("delivered", { timeout: 60_000 });
  await a.page.screenshot({ path: test.info().outputPath("letters-thread-en-light-phone.png"), fullPage: true });
});

test("when TapeRelay cannot be reached the letters say so, keep what is here, and recover on Try again (H13)", async ({
  player,
}) => {
  test.setTimeout(300_000);
  const p = await player({ lang: "en", scheme: "dark", size: "phone" });
  await hatch(p, "Kiri");
  await petLetters(p.page, false);
  await identity(p.page);
  await p.page.keyboard.press("Escape");
  // every relay node unreachable, as on a network that blocks them
  await p.page.route(/taperelay\.com/, (route) => route.abort("connectionrefused"));
  await p.page.reload();
  await p.page.locator(".stage").waitFor();
  await petLetters(p.page, false);
  const down = p.page.locator(".pl-down");
  await expect(down).toContainText("TapeRelay could not be reached. Your letters are safe here", { timeout: 60_000 });
  await p.page.screenshot({ path: test.info().outputPath("letters-down-en-dark-phone.png") });
  await p.page.unroute(/taperelay\.com/);
  await down.getByRole("button", { name: "Try again" }).click();
  await expect(down, "the relay answers again and the note goes").toHaveCount(0, { timeout: 60_000 });
  // the browser logs each request this test refused; those, and only those, were expected: anything else still fails
  const refused = p.errors.filter((e) => /ERR_CONNECTION_REFUSED/.test(e));
  expect(refused.length, "the blocked relay requests were made and refused").toBeGreaterThan(0);
  p.errors.splice(0, p.errors.length, ...p.errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e)));
});
