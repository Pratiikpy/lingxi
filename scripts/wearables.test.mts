/** A126: the README's count of pieces to wear is the player's wardrobe, and every piece in it is drawn. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PIECES } from "../packages/world/src/index.ts";
import { wearableOf } from "../packages/art/src/index.ts";

const root = join(import.meta.dirname, "..");

describe("the wardrobe the README counts (A126)", () => {
  it("the README's count is the number of pieces in the player's wardrobe", () => {
    const said = /<!--f:wearables-->(\d+)<!--\/f--> pieces to wear/.exec(
      readFileSync(join(root, "README.md"), "utf8"),
    )?.[1];
    expect(Number(said)).toBe(Object.keys(PIECES).length);
  });

  it("every piece in the wardrobe has a drawing, in the slot the wardrobe says", () => {
    for (const [id, p] of Object.entries(PIECES)) {
      const w = wearableOf(id);
      expect(w, id).toBeTruthy();
      expect(w!.slot, id).toBe(p.slot);
    }
  });
});
