/**
 * The ways a fight starts from outside the spar screen, each in the event that asks for it: a friend's duel link
 * accepted, and a friend's card asked for in a room (a damaged card says so for a moment, then the message goes).
 * Leaving the spar screen mid-fight ends the fight, as the screen's own state would: it opens again on the partners.
 */
import { randomBytes } from "node:crypto";
import { type Page } from "@playwright/test";
import { expect, hatch, sheet, test } from "../fixtures";
import { RoomSocket, keyedId, stored } from "../helpers/browser";
import { spotFor, tapVisitor } from "../helpers/room";

/** Leaving the spar screen mid-fight, then opening it again, finds the partners, not the fight. */
async function leaveMidFight(page: Page): Promise<void> {
  await expect(page.locator(".sp-fight"), "the fight plays").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet"), "the spar screen closes").toHaveCount(0);
  await sheet(page, "spar");
  await expect(page.locator(".sp-partners").first(), "it opens again on the partners").toBeVisible();
  await expect(page.locator(".sp-fight"), "the fight left with the screen").toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);
}

test("a friend's duel link opens straight onto the fight, and leaving ends it (en light phone, zh dark desktop)", async ({
  player,
}) => {
  test.setTimeout(240_000);
  const a = await player({ lang: "en", scheme: "light", size: "phone" });
  await hatch(a, "Ari");
  await sheet(a.page, "spar");
  await a.page.getByRole("button", { name: "Challenge a friend by link" }).click();
  const link = await a.page.locator(".sp-link").inputValue();
  // the server keeps the challenge; the link carries only its short id (A32)
  expect(link, "the link carries a short id for the challenge").toMatch(/#duel=s\.[A-Za-z0-9_-]{16}$/);

  const b = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  await hatch(b, "Bo");
  await b.page.goto(link.replace(/^https?:\/\/[^/]+\//, `${b.web}/`));
  const accept = b.page.getByRole("button", { name: "让Bo应战" });
  await accept.waitFor({ timeout: 20_000 });
  await b.page.screenshot({ path: test.info().outputPath("duel-arrival-zh-dark-desktop.png") });
  await accept.click();
  await expect(b.page.locator(".sheet"), "the spar screen opens onto the fight").toHaveCount(1);
  await expect(b.page.locator(".sp-fight"), "against the friend's pet").toContainText("Ari");
  await b.page.screenshot({ path: test.info().outputPath("duel-fight-zh-dark-desktop.png") });
  await leaveMidFight(b.page);
});

test("a duel's result comes back by a short link; a link the server does not keep says so (en light desktop challenges, zh dark phone answers)", async ({
  player,
}) => {
  test.setTimeout(240_000);
  const a = await player({ lang: "en", scheme: "light", size: "desktop" });
  await hatch(a, "Ari");
  await sheet(a.page, "spar");
  await a.page.getByRole("button", { name: "Challenge a friend by link" }).click();
  const link = await a.page.locator(".sp-link").inputValue();
  expect(link, "the challenge link is short enough for any chat").toMatch(/\/play\.html#duel=s\.[A-Za-z0-9_-]{16}$/);
  expect(link.length).toBeLessThan(120);
  await a.page.keyboard.press("Escape");

  const b = await player({ lang: "zh", scheme: "dark", size: "phone" });
  await hatch(b, "Bo");
  await b.page.goto(link.replace(/^https?:\/\/[^/]+\//, `${b.web}/`));
  await b.page.getByRole("button", { name: "让Bo应战" }).click();
  await b.page.getByRole("button", { name: "跳到结果" }).click();
  await b.page.getByRole("button", { name: /把结果发回给/ }).click();
  const back = await b.page.getByRole("textbox", { name: "结果链接" }).inputValue();
  expect(back, "the result link is short too").toMatch(/\/play\.html#duelr=s\.[A-Za-z0-9_-]{16}$/);
  await b.page.screenshot({ path: test.info().outputPath("duel-result-link-zh-dark-phone.png") });

  // the challenger opens the result and watches the fight
  await a.page.goto(back.replace(/^https?:\/\/[^/]+\//, `${a.web}/`));
  const replay = a.page.getByRole("dialog", { name: "Spar replay" });
  await expect(replay, "the result opens as the fight it was").toContainText("Bo vs Ari", { timeout: 20_000 });
  await a.page.screenshot({ path: test.info().outputPath("duel-result-en-light-desktop.png") });

  // a short id the server never kept: said plainly, with a way to try again, never "damaged"
  await a.page.goto(`${a.web}/play.html#duel=s.AAAAAAAAAAAAAAAA`);
  const lost = a.page.getByRole("dialog").filter({ hasText: "can't be found" });
  await expect(lost, "a link the server does not keep says so").toBeVisible({ timeout: 20_000 });
  await expect(lost.getByRole("button", { name: "Try again" })).toBeVisible();
  await a.page.screenshot({ path: test.info().outputPath("duel-lost-en-light-desktop.png") });
  await lost.getByRole("button", { name: "OK" }).click();
  await expect(lost).toHaveCount(0);
});

test("a friend's card starts a spar; a damaged one says so for a moment (en, light, phone)", async ({
  player,
  run,
}) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone", reducedMotion: true });
  const { page } = p;
  await hatch(p, "Kiri");
  const home = `home:${(await stored(page, "lingxi.player.v1"))!}`;

  // a friend in the player's home, whose card is a pet with no lessons yet; wherever its lane, the room stands it where
  // a phone shows it (A69), and close beside the player's pet is fine, since a tap answers only on a body (A25)
  const secret = randomBytes(16).toString("hex");
  const friendId = keyedId(secret);
  const friend = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
  friend.hello(home, friendId, secret, "Mallory");
  await friend.next("room");
  friend.send({ t: "card", lessons: JSON.stringify({ lessons: [] }) });

  const askSpar = async () => {
    const card = page.locator(".visitor-card");
    let last = "";
    for (let tries = 0; tries < 20 && !(await card.isVisible()); tries++) {
      last = await tapVisitor(page, spotFor(friendId), { nth: tries });
      await page.waitForTimeout(250);
    }
    await expect(card, `the friend's pet is picked (last tap ${last})`).toBeVisible();
    await card.getByRole("button", { name: "Spar" }).click();
  };

  await askSpar();
  await expect(page.locator(".sp-fight"), "the spar screen opens onto a fight with the friend's pet").toContainText(
    "Mallory",
  );
  await page.screenshot({ path: test.info().outputPath("card-fight-en-light-phone.png") });
  await leaveMidFight(page);

  // the friend's card is damaged now (well-formed, so the room keeps it, but no lesson the game knows): the room says
  // so, and the message goes by itself
  friend.send({ t: "card", lessons: JSON.stringify({ lessons: [{ nonsense: 1 }] }) });
  await page.waitForTimeout(500);
  await askSpar();
  const said = page.locator(".world-toast", { hasText: "Can't spar with that pet" });
  await expect(said, "a damaged card is said to be one").toBeVisible();
  await expect(page.locator(".sheet"), "and no spar screen opens").toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("card-damaged-en-light-phone.png") });
  await expect(said, "the message goes after a few seconds").toHaveCount(0, { timeout: 8_000 });
  friend.close();
});

test("Behemoth's card on Builders' Lane opens straight onto its fight (zh, dark, phone)", async ({ player }) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "phone" });
  const { page } = p;
  await hatch(p, "Momo");
  // the pet is already in Behemoth's room on the lane (room 66), as after walking there
  await page.evaluate(() => {
    const world = JSON.parse(localStorage.getItem("lingxi.world.v1")!) as { room: number };
    localStorage.setItem("lingxi.world.v1", JSON.stringify({ ...world, room: 66 }));
  });
  await page.reload();
  await page.getByRole("button", { name: "见见巨兽" }).click();
  await page.getByRole("button", { name: "和巨兽切磋" }).click();
  await expect(page.locator(".sp-fight"), "the spar screen opens onto a fight with Behemoth").toContainText("巨兽");
  await page.screenshot({ path: test.info().outputPath("behemoth-fight-zh-dark-phone.png") });
  await leaveMidFight(page);
});
