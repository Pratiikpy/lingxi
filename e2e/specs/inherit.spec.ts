/**
 * A27: before a player agrees to raise a little one, the proposal says what of their pet goes into it: every lesson,
 * with its instincts and skills, since the child's mind is both parents' whole minds.
 */
import { randomBytes } from "node:crypto";
import { expect, hatch, test } from "../fixtures";
import { RoomSocket, keyedId, stored } from "../helpers/browser";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", says: "Kiri hasn't learned a lesson yet; its instincts and skills go into the little one." },
  { lang: "zh", scheme: "dark", size: "desktop", says: "Kiri还没学过课；它的本能和技能会传给小宝宝。" },
] as const) {
  test(`a family proposal says what of the pet goes into the little one (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player, run }) => {
    test.setTimeout(180_000);
    const p = await player(look);
    const { page } = p;
    await hatch(p, "Kiri");
    const id = (await stored(page, "lingxi.player.v1"))!;
    const secret = randomBytes(16).toString("hex");
    const visitor = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
    visitor.hello(`home:${id}`, keyedId(secret), secret, "Tofu");
    await visitor.next("room");
    visitor.send({ t: "propose", to: id });
    const dialog = page.locator(".fam-modal");
    await dialog.waitFor({ timeout: 10_000 });
    await expect(dialog.locator(".fam-inherits")).toHaveText(look.says);
    await page.screenshot({ path: test.info().outputPath(`inherit-${look.lang}-${look.scheme}-${look.size}.png`) });
    visitor.close();
  });
}
