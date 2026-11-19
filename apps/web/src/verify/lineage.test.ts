import { describe, expect, it } from "vitest";
import { lineageNow } from "./lineage";
import type { PetHistoryRecord } from "./indexer";

const child = (brainId: string): PetHistoryRecord => ({ hatched: { block: 1, tx: "0x1", line: 0, brainId, state: "0" }, saves: [], brains: [], parents: ["1", "3"], children: [] });

describe("a child's lineage as the chain says it (A24)", () => {
  it("is kept while its brain is the circuit the Breeder checked at birth", () => {
    expect(lineageNow(child("9"), "9")).toBe("kept");
  });

  it("is said to have changed once its brain is another circuit, though its parents stay", () => {
    expect(lineageNow(child("9"), "12")).toBe("changed");
  });

  it("is nothing to say for a pet hatched from an egg, or one not indexed yet", () => {
    expect(lineageNow({ ...child("9"), parents: undefined }, "9")).toBeNull();
    expect(lineageNow({ saves: [], brains: [], children: [], parents: ["1", "3"] }, "9")).toBeNull();
  });
});
