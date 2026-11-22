/**
 * C1: the Builders' Lane total sums every processor's circuits. A processor's `nextId` is the id of its latest
 * circuit (ids start at 1; read back on mainnet), so it is that processor's count, and a processor whose count
 * cannot be read this time keeps the count it last had rather than dropping to zero.
 */
import { describe, expect, it } from "vitest";
import { circuitsTotal } from "../src/laneReader";
// circuitsTotal returns the sum and whether every processor has been read at least once

const ok = (n: number) => ({ status: "success" as const, result: BigInt(n) });
const failed = { status: "failure" as const, error: new Error("timeout") };

describe("the Builders' Lane total (C1)", () => {
  it("counts each processor's latest circuit id as its circuits", () => {
    const known = new Map<string, number>();
    expect(circuitsTotal(["0xa", "0xb", "0xc"], [ok(23), ok(3), ok(0)], known)).toEqual({ total: 26, complete: true });
  });

  it("keeps a processor's last count when its read fails, instead of counting it as empty", () => {
    const known = new Map<string, number>();
    circuitsTotal(["0xa", "0xb"], [ok(23), ok(3)], known);
    expect(circuitsTotal(["0xa", "0xb"], [failed, ok(4)], known)).toEqual({ total: 27, complete: true });
  });

  it("says the total is incomplete while a processor has never been read", () => {
    expect(circuitsTotal(["0xa", "0xb"], [ok(5), failed], new Map())).toEqual({ total: 5, complete: false });
  });
});
