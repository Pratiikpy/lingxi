/** Reaching another pet in a room from a test: where the room puts it, and a tap on the scene there. */
import { type Page } from "@playwright/test";

/** Where the room puts a visiting pet that does not move (reduced motion): a lane picked from its id. */
export function spotFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return [26, 42, 86, 102, 34, 94, 18, 110][h % 8]!;
}

/** Taps the room at a point of its 128-pixel scene, as `patPet` does for the player's own pet. */
export async function tapScene(page: Page, x: number, y: number): Promise<string> {
  const box = (await page.locator(".room-scene").boundingBox())!;
  const scale = Math.max(1, Math.ceil(Math.max(box.width, box.height) / 128));
  const left = box.x + Math.round((box.width - 128 * scale) / 2);
  const top = box.y + Math.round((box.height - 128 * scale) / 2);
  const at = { x: left + x * scale, y: top + y * scale };
  const under = await page.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y);
    return e ? `${e.tagName}.${e.className}` : "nothing";
  }, at);
  await page.mouse.click(at.x, at.y);
  return `${Math.round(at.x)},${Math.round(at.y)} on ${under}`;
}
