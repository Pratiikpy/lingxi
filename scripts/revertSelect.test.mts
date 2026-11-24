import { describe, expect, it } from "vitest";
import { changedEntries } from "./lib/revertSelect.mts";

const entry = (id: string, name = `the test for ${id}`) => ({
  id,
  row: "A1",
  bug: `bug ${id}`,
  test: { kind: "vitest" as const, dir: "apps/web", file: "src/x.test.ts", name },
});

describe("which revert entries a push asks for (A35)", () => {
  it("picks entries new in the list, changed in the list, or whose patch changed, and nothing else", () => {
    const before = [entry("A1-a"), entry("A1-b"), entry("A1-c")];
    const after = [entry("A1-a"), entry("A1-b", "a renamed test"), entry("A1-c"), entry("A1-d")];
    expect(changedEntries(before, after, ["scripts/regressions/A1-c.patch"]).map((e) => e.id)).toEqual([
      "A1-b",
      "A1-c",
      "A1-d",
    ]);
  });

  it("picks nothing when nothing about the entries changed", () => {
    const list = [entry("A1-a"), entry("A1-b")];
    expect(changedEntries(list, list, ["apps/web/src/game/chain.ts", "README.md"])).toEqual([]);
  });

  it("picks every entry when the commit before the push is not known (a new branch)", () => {
    const after = [entry("A1-a"), entry("A1-b")];
    expect(changedEntries(null, after, []).map((e) => e.id)).toEqual(["A1-a", "A1-b"]);
  });

  it("ignores a changed patch whose entry has left the list", () => {
    expect(changedEntries([entry("A1-a"), entry("A1-z")], [entry("A1-a")], ["scripts/regressions/A1-z.patch"])).toEqual(
      [],
    );
  });
});
