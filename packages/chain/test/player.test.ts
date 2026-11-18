import { describe, expect, it } from "vitest";
import { PLAYER_SECRET, playerIdFor } from "../src/player";

describe("player ids", () => {
  it("come from the device's secret: fixed, 24 hex characters, different for every secret", () => {
    const a = playerIdFor("a".repeat(32));
    expect(a).toMatch(/^[a-f0-9]{24}$/);
    expect(playerIdFor("a".repeat(32))).toBe(a);
    expect(playerIdFor("b".repeat(32))).not.toBe(a);
    expect(PLAYER_SECRET.test("A".repeat(32))).toBe(false);
  });
});
