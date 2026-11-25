/**
 * P7b: on a phone an adult pet and an adult resident both show whole. Side by side two adults need 78 room pixels and
 * 2 clear at each edge; a narrow phone whose room is taller than 384 px shows fewer (320 px wide: about 72), so the
 * resident stood past the edge of what shows. Now it stands a little behind the
 * pet instead, both inside the view. Checked as a player would: the resident's outer side, where it now stands inside
 * the view, answers a tap with its own sheet, and the screenshot shows both whole.
 */
import { type Page } from "@playwright/test";
import { HALF, viewOf } from "../../apps/web/src/scene/floor";
import { placeResident } from "../../apps/web/src/scene/residentSpot";
import { expect, hatch, test } from "../fixtures";
import { tapScene } from "../helpers/room";

const DAY = 86_400_000;

/** The pet grown to an adult (nine days of game time) and standing in `room`, written before the game's next load. */
async function grownIn(page: Page, room: number): Promise<void> {
  await page.addInitScript(
    ({ ms, room }) => {
      // not on a blank page the test leaves through, where the browser denies storage
      if (location.protocol === "about:" || sessionStorage.getItem("p7b.set")) return;
      const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<{ bornAt: number }> };
      save.pets[0]!.bornAt -= ms;
      localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
      const world = JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as { room?: number };
      localStorage.setItem("lingxi.world.v1", JSON.stringify({ ...world, room }));
      sessionStorage.setItem("p7b.set", "1");
    },
    { ms: 9 * DAY, room },
  );
  await page.reload();
  await page.locator(".room-scene[data-ready]").waitFor();
  await page.waitForTimeout(1_200);
}

for (const look of [
  { lang: "en", scheme: "light", room: 66, x: 102, name: "Behemoth" },
  { lang: "zh", scheme: "dark", room: 29, x: 26, name: "小火星" },
] as const) {
  test(`an adult pet and an adult resident both show whole on a phone (${look.lang}, ${look.scheme}, phone) (P7b)`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: "phone" });
    const { page } = p;
    // a narrow, tall phone: its room is taller than 384 px, so it is drawn four times over and shows under 82 of the
    // room's 128 pixels, too few for two adults side by side (a 390 px phone shows 85 to 119, where they fit)
    await page.setViewportSize({ width: 320, height: 960 });
    await hatch(p, "Momo");
    await grownIn(page, look.room);
    const box = (await page.locator(".room-scene").boundingBox())!;
    const view = viewOf(box.width, box.height);
    expect(view.right - view.left, "this phone shows too little room for two adults side by side").toBeLessThan(
      2 * HALF.adult * 2 + 6 + 4,
    );
    const at = placeResident({ id: "r", stage: "adult", x: look.x }, "adult", view);
    const spot = at.spot!.x;
    // both whole inside what shows
    for (const c of [at.petX, spot]) {
      expect(c - HALF.adult, "inside the left edge").toBeGreaterThanOrEqual(view.left);
      expect(c + HALF.adult, "inside the right edge").toBeLessThanOrEqual(view.right);
    }
    // the resident's outer side, which the pet does not cover: a tap there is a tap on the resident
    const outer = spot > at.petX ? spot + 0.6 * HALF.adult : spot - 0.6 * HALF.adult;
    await tapScene(page, outer, 96);
    await expect(page.locator(".sheet .shead h2"), "the resident answers a tap on its far side").toHaveText(look.name);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.screenshot({ path: test.info().outputPath(`resident-fit-${look.lang}-${look.scheme}-phone.png`) });
  });
}
