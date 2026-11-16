/**
 * Giving things to the residents (plan 4.1). A gift leaves the bag for good, like the source's "Give" button that
 * burns items (note A §1.3, ITEM_BURN); quests ask for it by item, by resident, or both.
 */

import { CHARACTERS } from "./characters";
import { LANE } from "./conditions";
import { bump, bumpAll } from "./tally";
import { ITEM, type WorldResult, type WorldState, has } from "./world";

/** Residents, and the Builders' Lane pets, who take gifts at their card. */
const RESIDENTS = new Set([...CHARACTERS.map((c) => c.id), ...LANE]);

/** Hand `n` of an item to a resident: GIVE:item and GIVE_TO:resident and GIVE_TO:resident:item all rise by `n`. */
export function giveTo(w: WorldState, resident: string, item: number, n = 1): WorldResult {
  if (!RESIDENTS.has(resident)) return { ok: false, reason: "noResident" };
  if (!ITEM[item]) return { ok: false, reason: "noItem" };
  if (!Number.isInteger(n) || n < 1) return { ok: false, reason: "badAmount" };
  if (!has(w, item, n)) return { ok: false, reason: "missing" };
  const left = (w.bag[item] ?? 0) - n;
  const bag = { ...w.bag };
  if (left > 0) bag[item] = left;
  else delete bag[item];
  return {
    ok: true,
    world: bump(
      bumpAll({ ...w, bag }, [
        ["GIVE", item, n],
        ["GIVE_TO", resident, n],
      ]),
      "GIVE_TO",
      `${resident}:${item}`,
      n,
      { total: false },
    ),
  };
}
