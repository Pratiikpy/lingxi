/** A136: a pet whose brain is another line's starter is said so on its proof page. */
import { describe, expect, it } from "vitest";
import { otherStarter } from "./starterNote";

const circuits = { gentle: { id: "1" }, bold: { id: "2" }, curious: { id: "3" }, evolution: { id: "4" } };

describe("a brain that is another line's starter (A136)", () => {
  it("names the line whose starter it is, for a pet of another line", () => {
    // pet #2 on mainnet: hatched gentle (line 0) with circuit #2, the bold starter
    expect(otherStarter(0, 2n, circuits)).toBe(1);
  });

  it("says nothing of a pet on its own line's starter, or on a circuit that is no starter", () => {
    expect(otherStarter(0, 1n, circuits)).toBeNull();
    expect(otherStarter(2, 3n, circuits)).toBeNull();
    expect(otherStarter(1, 4n, circuits)).toBeNull();
    expect(otherStarter(1, 77n, circuits)).toBeNull();
    expect(otherStarter(0, 2n, undefined)).toBeNull();
  });
});
