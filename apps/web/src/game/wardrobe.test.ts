import { describe, expect, it } from "vitest";
import { WEARABLE, WEARABLES } from "@lingxi/art";
import { PIECES } from "@lingxi/world";

describe("wardrobe and art agree", () => {
  it("every piece the game knows is drawn, in the same slot and set", () => {
    for (const [id, p] of Object.entries(PIECES)) {
      expect(WEARABLE[id], id).toBeTruthy();
      expect(WEARABLE[id]!.slot).toBe(p.slot);
      expect(WEARABLE[id]!.set).toBe(p.set);
    }
    expect(WEARABLES.length).toBe(Object.keys(PIECES).length);
  });
});
