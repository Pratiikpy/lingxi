// @vitest-environment happy-dom
/**
 * H5: the game opens gradually, but never in a player's way. Teaching is there from the first day, a quest that
 * points at a part opens it whatever the day, and the rest opens on the days it always did.
 */
import { describe, expect, it } from "vitest";
import type { Pet } from "@lingxi/game";
import { ONBOARDING, QUEST_BY_ID } from "@lingxi/world";
import { isOpen, openedByQuests } from "./reveal";

const T0 = Date.UTC(2026, 10, 18, 9);
const DAY = 86_400_000;
/** what the reveal reads of a pet: when it was born */
const pet = { bornAt: T0 } as Pet;

describe("what is open, and when (H5)", () => {
  it("on day 1 teaching is open; the map, the bag and spars wait for their day", () => {
    expect(isOpen("mind", pet, false, T0)).toBe(true);
    expect(["map", "bag", "spar"].map((p) => isOpen(p, pet, false, T0))).toEqual([false, false, false]);
    expect(["map", "bag", "spar"].map((p) => isOpen(p, pet, false, T0 + DAY))).toEqual([true, true, false]);
    expect(isOpen("spar", pet, false, T0 + 2 * DAY)).toBe(true);
    expect(isOpen("spar", pet, true, T0)).toBe(true);
  });

  it("a quest that points at a part opens it on day 1, from the moment it is taken", () => {
    const at = (status: "active" | "available" | "done", hint: string) => {
      const q = ONBOARDING.map((id) => QUEST_BY_ID[id]!).find((x) => x.hint === hint)!;
      return { [q.id]: status };
    };
    expect(openedByQuests(at("active", "map"))).toEqual(["map"]);
    expect(openedByQuests(at("done", "bag"))).toEqual(["bag"]);
    // only offered, not taken: nothing opens yet
    expect(openedByQuests(at("available", "map"))).toEqual([]);
    expect(isOpen("map", pet, false, T0, openedByQuests(at("active", "map")))).toBe(true);
  });

  it("every first-arc quest's hint points at something open by the time the quest is taken", () => {
    const statuses: Record<string, "active"> = {};
    for (const id of ONBOARDING) {
      statuses[id] = "active";
      const hint = QUEST_BY_ID[id]!.hint;
      const gated = ({ map: "map", bag: "bag", teach: "mind" } as Record<string, string>)[hint ?? ""];
      if (gated) expect(isOpen(gated, pet, false, T0, openedByQuests(statuses)), `${id} points at ${hint}`).toBe(true);
    }
  });
});
