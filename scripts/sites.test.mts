/** A85: one rule for whether a site serves this commit, for the status check and the claims check alike. */
import { describe, expect, it } from "vitest";
import { currentness, parseBuild } from "./lib/sites.mts";

const head = "b".repeat(40);
const old = "a".repeat(40);

describe("whether a site is current (A85)", () => {
  it("built from this commit, it is current", () => {
    expect(currentness({ commit: head, dirty: false, builtAt: "now" }, head, () => false).current).toBe(true);
  });

  it("built from an older commit, it is current only when nothing it is made of changed since", () => {
    expect(currentness({ commit: old, dirty: false, builtAt: "then" }, head, () => true).current).toBe(true);
    const stale = currentness({ commit: old, dirty: false, builtAt: "then" }, head, () => false);
    expect(stale).toEqual({
      current: false,
      why: `serves ${old.slice(0, 12)}, and what it is built from changed since: redeploy`,
    });
  });

  it("built from uncommitted changes, it is never current", () => {
    expect(currentness({ commit: head, dirty: true, builtAt: "now" }, head, () => true).current).toBe(false);
  });

  it("reads a build.json, and refuses one with no commit", () => {
    expect(parseBuild(JSON.stringify({ commit: head, dirty: false, builtAt: "x" }))).toEqual({
      commit: head,
      dirty: false,
      builtAt: "x",
    });
    expect(parseBuild("{}")).toBe("build.json has no commit");
  });
});
