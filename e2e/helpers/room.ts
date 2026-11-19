/** Reaching another pet in a room from a test: where the room puts it, and a tap on the scene there. */
import { type Page } from "@playwright/test";
import { HALF, PET_HOME, floorSpot, laneOf, viewOf } from "../../apps/web/src/scene/floor";

/** A visiting pet's lane in the whole room, from its id (the room keeps it within what shows: `visitorPoint`). */
export const spotFor = laneOf;

type Stage = keyof typeof HALF;

/**
 * The room pixel to tap a visitor whose lane is `lane`: where the room stands it on the floor this page shows (A69),
 * in the middle of the part of its body the player's own pet does not cover (a pet is drawn over visitors, and a tap
 * answers only on a body, A25). Bodies are taken as 0.7 of a pet's half-width, inside its outline. `nth` moves along
 * that part, for another try.
 */
export async function visitorPoint(page: Page, lane: number, opts: { visitor?: Stage; own?: Stage; nth?: number } = {}): Promise<number> {
  const { visitor = "adult", own = "baby", nth = 0 } = opts;
  const box = (await page.locator(".room-scene").boundingBox())!;
  const x = floorSpot(lane, viewOf(box.width, box.height), HALF[visitor]);
  const [a, b] = [x - 0.7 * HALF[visitor], x + 0.7 * HALF[visitor]];
  const [p, q] = [PET_HOME - 0.7 * HALF[own], PET_HOME + 0.7 * HALF[own]];
  const clear = [
    [a, Math.min(b, p)],
    [Math.max(a, q), b],
  ].filter(([s, e]) => e! - s! > 1) as Array<[number, number]>;
  const [s, e] = clear.sort((u, v) => v[1] - v[0] - (u[1] - u[0]))[0] ?? [x, x];
  return s + (e - s) * [0.5, 0.3, 0.7][nth % 3]!;
}

/** Taps a visitor whose lane is `lane` (see `visitorPoint`); returns where, and what was under the tap. */
export async function tapVisitor(page: Page, lane: number, opts: { visitor?: Stage; own?: Stage; nth?: number } = {}): Promise<string> {
  return tapScene(page, await visitorPoint(page, lane, opts), 96);
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
