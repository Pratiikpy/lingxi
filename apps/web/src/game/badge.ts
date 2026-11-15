/**
 * The pet on your home screen (PRD Y1). An installed Lingxi shows a number on its
 * app icon when the pet needs you (hungry, grubby, worn out, ill or lonely), the
 * way a Tamagotchi chirps from a pocket, and clears it when all is well. Browsers
 * without the App Badging API simply show nothing.
 */

import { type Pet, toVisible } from "@lingxi/game";

/** What the pet needs right now: each one adds to the icon's number. */
export function needsOf(pet: Pet): Array<"food" | "clean" | "rest" | "joy" | "medicine"> {
  const out: Array<"food" | "clean" | "rest" | "joy" | "medicine"> = [];
  if (pet.sick) out.push("medicine");
  if (toVisible(pet.meters.food) < 250) out.push("food");
  if (toVisible(pet.meters.clean) < 250) out.push("clean");
  if (!pet.asleep && toVisible(pet.meters.energy) < 200) out.push("rest");
  if (toVisible(pet.meters.joy) < 250) out.push("joy");
  return out;
}

type BadgeNav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function showNeeds(pet: Pet | null): void {
  const nav = navigator as BadgeNav;
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  const n = pet ? needsOf(pet).length : 0;
  (n ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(() => undefined);
}
