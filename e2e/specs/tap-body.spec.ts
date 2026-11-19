/**
 * A25: a tap reaches the pet it lands on. A friend standing close beside the player's pet (lanes 42 and 86, inside the
 * pet's picture but outside its body) opens its card when tapped, and the player's pet is not patted by that tap; a tap
 * on the pet's own body still pats it.
 */
import { randomBytes } from "node:crypto";
import { type Page } from "@playwright/test";
import { careCount, expect, hatch, patPet, test } from "../fixtures";
import { RoomSocket, keyedId, stored } from "../helpers/browser";
import { spotFor, tapScene } from "../helpers/room";

/** A28: the visitor card and every control in it lie inside the room, and every button's text reads at 4.5:1 or more. */
async function cardFitsAndReads(page: Page): Promise<void> {
  const r = await page.evaluate(() => {
    const room = document.querySelector(".stage")!.getBoundingClientRect();
    const card = document.querySelector(".visitor-card")!;
    const inside = (e: Element) => {
      const b = e.getBoundingClientRect();
      return b.left >= room.left - 0.5 && b.right <= room.right + 0.5 && b.top >= room.top - 0.5 && b.bottom <= room.bottom + 0.5;
    };
    const lum = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const controls = [card, ...card.querySelectorAll("b, button")];
    const buttons = [...card.querySelectorAll("button.btn")].map((btn) => {
      const st = getComputedStyle(btn);
      return { text: (btn as HTMLElement).innerText.trim(), contrast: ratio(st.color, st.backgroundColor) };
    });
    return { outside: controls.filter((e) => !inside(e)).map((e) => (e as HTMLElement).innerText.trim() || e.className), buttons };
  });
  expect(r.outside, "the card and its controls lie inside the room").toEqual([]);
  for (const b of r.buttons) expect(b.contrast, `"${b.text}" reads against its button`).toBeGreaterThanOrEqual(4.5);
}

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a friend beside the pet can be tapped, and the pet still can (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player, run }) => {
    test.setTimeout(240_000);
    const p = await player({ ...look, reducedMotion: true });
    const { page } = p;
    await hatch(p, "Kiri");
    const home = `home:${(await stored(page, "lingxi.player.v1"))!}`;

    for (const lane of [42, 86]) {
      let secret = randomBytes(16).toString("hex");
      while (spotFor(keyedId(secret)) !== lane) secret = randomBytes(16).toString("hex");
      const id = keyedId(secret);
      const friend = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
      friend.hello(home, id, secret, `Lane${lane}`);
      await friend.next("room");
      const pats = await careCount(page, "pet");
      const card = page.locator(".visitor-card");
      let last = "";
      for (let tries = 0; tries < 12 && !(await card.isVisible()); tries++) {
        last = await tapScene(page, lane, 96);
        await page.waitForTimeout(250);
      }
      await expect(card, `the friend at lane ${lane} is picked (last tap ${last})`).toBeVisible();
      await expect(card.locator("b")).toHaveText(`Lane${lane}`);
      await cardFitsAndReads(page);
      expect(await careCount(page, "pet"), `tapping the friend at lane ${lane} does not pat the pet`).toBe(pats);
      await page.screenshot({ path: test.info().outputPath(`tap-lane${lane}-${look.lang}-${look.scheme}-${look.size}.png`) });
      await card.locator(".icon-x").click();
      friend.close();
      await expect(card).toHaveCount(0);
    }
    // the pet's own body still answers
    await patPet(page);
  });
}
