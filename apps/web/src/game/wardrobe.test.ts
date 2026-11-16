import { describe, expect, it } from "vitest";
import { WEARABLES, wearableOf } from "@lingxi/art";
import { PIECES } from "@lingxi/world";

describe("wardrobe and art agree", () => {
  it("every piece the game knows is drawn, in the same slot and set", () => {
    for (const [id, p] of Object.entries(PIECES)) {
      const art = wearableOf(id);
      expect(art, id).toBeTruthy();
      expect(art!.slot, id).toBe(p.slot);
      // Builders' Lane pieces are drawn with the lane's residents and belong to no outfit set
      if (p.set === "lane") expect(art!.set, id).toBeUndefined();
      else expect(art!.set, id).toBe(p.set);
    }
    // and every piece art draws for players is one the game knows
    expect(WEARABLES.length).toBe(Object.values(PIECES).filter((p) => p.set !== "lane").length);
  });
});
