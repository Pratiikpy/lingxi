/** A106: the rows without a revert pair are named in the README, each with its reason, and none has a pair after all. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const without = JSON.parse(readFileSync(join(root, "scripts/regressions/without.json"), "utf8")) as Record<
  string,
  string
>;
const pairs = new Set(
  (JSON.parse(readFileSync(join(root, "scripts/regressions/list.json"), "utf8")) as Array<{ row: string }>).map(
    (e) => e.row,
  ),
);

describe("the rows without a revert pair (A106)", () => {
  it("are named in the README exactly, each with a reason, and none of them has a pair", () => {
    const named =
      /<!--f:revert-without-->([^<]*)<!--\/f-->/.exec(readFileSync(join(root, "README.md"), "utf8"))?.[1] ?? "";
    expect(named.split(", ").filter(Boolean).sort()).toEqual(Object.keys(without).sort());
    for (const [row, why] of Object.entries(without)) {
      expect(why.length, `${row} says why`).toBeGreaterThan(30);
      expect(pairs.has(row), `${row} is listed without a pair, so it has none`).toBe(false);
    }
  });
});
