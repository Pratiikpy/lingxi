import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJSON, strictParse } from "../src/tap";
import { hiddenText, normaliseTools, toolsDigest } from "../src/tapTools";

// TAP-15's vectors (CC0), copied from TapeOutProtocol/TAPs at 527477e
const dir = join(dirname(fileURLToPath(import.meta.url)), "vectors", "tap");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const parse = (text: string): unknown => {
  try {
    return strictParse(text);
  } catch {
    return undefined;
  }
};

describe("the tool-list digest (TAP-15 §3)", () => {
  const v = load("tap15-tools-digest.json");
  for (const c of v.positive as Array<{ name: string; toolsJson: string; normalized: string; toolsSha256: string }>) {
    it(c.name, () => {
      const tools = parse(c.toolsJson);
      expect(canonicalJSON(normaliseTools(tools))).toBe(c.normalized);
      expect(toolsDigest(tools)).toBe(c.toolsSha256);
    });
  }
  it(`${(v.negative as unknown[]).length} lists with no digest`, () => {
    for (const c of v.negative as Array<{ name: string; toolsJson: string }>) {
      // a text the strict parser refuses has no list at all, and so no digest
      const tools = parse(c.toolsJson);
      expect(tools === undefined ? null : toolsDigest(tools), c.name).toBeNull();
    }
  });
  it("the envelope vectors' upstream and drifted lists", () => {
    const e = load("tap15-envelopes.json");
    expect(toolsDigest(e.upstreamTools)).toBe(e.toolsSha256);
    expect(toolsDigest(e.driftedTools)).toBe(e.driftedToolsSha256);
    expect(toolsDigest(e.undigestibleTools)).toBeNull();
  });
});

describe("hidden text (TAP-15 §3.4)", () => {
  const v = load("tap15-hidden-text.json");
  for (const c of v.cases as Array<{ name: string; toolsJson: string; refused: boolean; problems: string[] }>) {
    it(c.name, () => {
      const found = hiddenText(strictParse(c.toolsJson));
      expect(found.length > 0, found.join("; ")).toBe(c.refused);
      // the first hidden code point of each string agrees with the reference's report
      const points = (s: string[]) => s.map((x) => x.slice(x.lastIndexOf("U+")));
      if (c.refused) expect(points(found)).toEqual(points(c.problems));
    });
  }
});
