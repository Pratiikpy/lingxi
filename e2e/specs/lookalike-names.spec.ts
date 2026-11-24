/**
 * A16: no pet in a room can pass for another. A visitor whose client sends "Mochi" plus an invisible Arabic letter mark
 * (U+061C), as a hand-made client could, is shown as "Mochi" with the mark drawn as U+FFFD, never as plain "Mochi".
 */
import { randomBytes } from "node:crypto";
import { expect, hatch, test } from "../fixtures";
import { RoomSocket, keyedId, stored } from "../helpers/browser";
import { spotFor, tapVisitor } from "../helpers/room";

const LOOKALIKE = "Mochi\u061c";
const SHOWN = "Mochi\ufffd";

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a visitor's look-alike name is shown with its hidden mark (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
    run,
  }) => {
    test.setTimeout(240_000);
    const p = await player({ ...look, reducedMotion: true });
    const { page } = p;
    await hatch(p, "Kiri");
    const home = `home:${(await stored(page, "lingxi.player.v1"))!}`;
    // a visitor, wherever its lane: the room stands it where a phone shows it (A69)
    const secret = randomBytes(16).toString("hex");
    const visitorId = keyedId(secret);
    const visitor = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
    visitor.hello(home, visitorId, secret, LOOKALIKE);
    await visitor.next("room");

    const card = page.locator(".visitor-card");
    let last = "";
    for (let tries = 0; tries < 20 && !(await card.isVisible()); tries++) {
      last = await tapVisitor(page, spotFor(visitorId), { nth: tries });
      await page.waitForTimeout(250);
    }
    await expect(card, `the visitor is picked (last tap ${last})`).toBeVisible();
    await expect(card.locator("b"), "its name shows the hidden mark").toHaveText(SHOWN);
    expect(await card.locator("b").textContent(), "and never as plain Mochi").not.toBe("Mochi");
    await page.screenshot({ path: test.info().outputPath(`lookalike-${look.lang}-${look.scheme}-${look.size}.png`) });
    visitor.close();
  });
}
