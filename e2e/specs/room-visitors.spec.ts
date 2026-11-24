/**
 * A69: every visitor in the room can be seen and reached. A phone shows only the middle of the room, so the room stands
 * visitors on the floor that shows, whatever their lane; and the bar's count opens a list of who is here, each name
 * opening that pet's card (the way for a keyboard, a screen reader, or a crowded room).
 */
import { randomBytes } from "node:crypto";
import { expect, hatch, test } from "../fixtures";
import { RoomSocket, keyedId, stored } from "../helpers/browser";
import { spotFor, tapVisitor, visitorPoint } from "../helpers/room";
import { viewOf } from "../../apps/web/src/scene/floor";

/** A visitor's key whose lane is `lane`. */
function keyFor(lane: number): string {
  let secret = randomBytes(16).toString("hex");
  while (spotFor(keyedId(secret)) !== lane) secret = randomBytes(16).toString("hex");
  return secret;
}

test("on a phone, visitors at the room's outermost lanes stand where it shows and open with a tap (en, light, phone)", async ({
  player,
  run,
}) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone", reducedMotion: true });
  const { page } = p;
  await hatch(p, "Kiri");
  // a tall phone (390 by 932): its room is cropped to the middle, which is what this checks. On a shorter phone the home
  // screen's lines below the room leave it under 384 pixels tall, and the room is drawn smaller and shows almost whole
  // (pixels 5 to 123), so no lane would be outside it (P3a)
  await page.setViewportSize({ width: 390, height: 932 });
  const home = `home:${(await stored(page, "lingxi.player.v1"))!}`;
  const card = page.locator(".visitor-card");
  const friends: RoomSocket[] = [];
  for (const [lane, name] of [
    [18, "Westy"],
    [110, "Easty"],
  ] as const) {
    const secret = keyFor(lane);
    const friend = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
    friend.hello(home, keyedId(secret), secret, name);
    await friend.next("room");
    friends.push(friend);
    // the room's 128 pixels are cropped on a phone to its middle: the visitor's lane is outside it
    const box = (await page.locator(".room-scene").boundingBox())!;
    const shown = viewOf(box.width, box.height);
    expect(
      lane < shown.left || lane > shown.right,
      `lane ${lane} is outside what a phone shows (${shown.left.toFixed(1)}..${shown.right.toFixed(1)})`,
    ).toBe(true);
    const at = await visitorPoint(page, lane);
    expect(at, "the point tapped is inside what shows").toBeGreaterThan(shown.left);
    expect(at).toBeLessThan(shown.right);
    let last = "";
    for (let tries = 0; tries < 12 && !(await card.isVisible()); tries++) {
      last = await tapVisitor(page, lane, { nth: tries });
      await page.waitForTimeout(250);
    }
    await expect(card, `the visitor at lane ${lane} is seen and picked (last tap ${last})`).toBeVisible();
    await expect(card.locator("b")).toHaveText(name);
    await page.screenshot({ path: test.info().outputPath(`edge-lane${lane}-en-light-phone.png`) });
    await card.locator(".icon-x").click();
    await expect(card).toHaveCount(0);
  }

  // the count opens the list of who is here, and a name opens its card
  const count = page.locator(".social .here");
  await expect(count).toHaveText("2 here");
  await count.click();
  const list = page.getByRole("dialog", { name: "Who's here" });
  await expect(list.locator(".here-one")).toHaveText(["Westy", "Easty"]);
  await expect(list.locator(".here-one").first(), "the first name takes the keyboard's focus").toBeFocused();
  await page.screenshot({ path: test.info().outputPath("here-list-en-light-phone.png") });
  await page.keyboard.press("Escape");
  await expect(list, "Escape shuts the list").toHaveCount(0);
  await expect(count, "and gives the focus back to the count").toBeFocused();
  await count.click();
  await list.getByRole("button", { name: "Easty" }).click();
  await expect(list).toHaveCount(0);
  await expect(card.locator("b"), "the name opens that pet's card").toHaveText("Easty");
  for (const f of friends) f.close();
});

test("the count opens the list of who is here, in Chinese and the dark look (zh, dark, desktop)", async ({
  player,
  run,
}) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "desktop", reducedMotion: true });
  const { page } = p;
  await hatch(p, "Kiri");
  const home = `home:${(await stored(page, "lingxi.player.v1"))!}`;
  const secret = randomBytes(16).toString("hex");
  const friend = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
  friend.hello(home, keyedId(secret), secret, "小团子");
  await friend.next("room");

  const count = page.locator(".social .here");
  await expect(count).toHaveText("1 位朋友在这里");
  await count.click();
  const list = page.getByRole("dialog", { name: "谁在这里" });
  await expect(list.locator(".here-one")).toHaveText(["小团子"]);
  // the list reads on its light paper in the dark look
  expect(await list.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 253, 248)");
  expect(await list.locator(".here-one").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(43, 33, 64)");
  await page.screenshot({ path: test.info().outputPath("here-list-zh-dark-desktop.png") });
  await list.getByRole("button", { name: "关闭" }).click();
  await expect(list).toHaveCount(0);
  await count.click();
  await list.getByRole("button", { name: "小团子" }).click();
  await expect(page.locator(".visitor-card b"), "the name opens that pet's card").toHaveText("小团子");
  await page.screenshot({ path: test.info().outputPath("here-card-zh-dark-desktop.png") });
  friend.close();
});
