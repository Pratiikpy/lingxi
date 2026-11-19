/**
 * A pet lives by the time zone of the device it is on, as it is now (P1). Its zone was once fixed at hatch, so a pet
 * hatched in India kept India's mornings after its owner opened the game in New York. The same save, opened on a
 * device in another zone, must move the pet to that zone.
 */
import { expect, hatch, savedPet, test } from "../fixtures";

const zoneOf = async (page: Parameters<typeof savedPet>[0]) => ((await savedPet(page)) as { tzOffsetMin?: number } | null)?.tzOffsetMin;

test("a pet follows the time zone of the device it is on (P1)", async ({ player }) => {
  const india = await player({ timezoneId: "Asia/Kolkata" });
  await hatch(india, "Pip");
  await expect.poll(() => zoneOf(india.page), { message: "hatched in India: UTC+5:30" }).toBe(330);
  // the whole save, carried to a browser in New York (as a save file would carry it), less the first tab's writer stamp
  const save = await india.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("lingxi.") && k !== "lingxi.writer.lease").map((k) => [k, localStorage.getItem(k)!])));
  await india.ctx.close();

  const ny = await player({ timezoneId: "America/New_York", init: `if (!localStorage.getItem("lingxi.pets.v2")) { const s = ${JSON.stringify(save)}; for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); }` });
  await ny.page.goto(`${ny.web}/play.html`);
  await ny.page.locator(".stage").waitFor({ timeout: 60_000 });
  // New York in November: UTC-5
  await expect.poll(() => zoneOf(ny.page), { message: "opened in New York, the pet lives by New York's day", timeout: 30_000 }).toBe(-300);
});
