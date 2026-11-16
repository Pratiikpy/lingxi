import { describe, expect, it } from "vitest";
import { FACES_L, FACES_S } from "@lingxi/art";
import { PET_FACES } from "@lingxi/world";

describe("the quest line's pet faces", () => {
  it("are exactly the faces the pet is drawn with, at both sizes", () => {
    expect([...PET_FACES].sort()).toEqual(Object.keys(FACES_L).sort());
    expect([...PET_FACES].sort()).toEqual(Object.keys(FACES_S).sort());
  });
});
