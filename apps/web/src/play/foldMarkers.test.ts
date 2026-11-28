/**
 * R68: a fold-out shows that it opens. A <summary> draws its open marker (▶, ▼) only while it is displayed as a list
 * item; a rule that lays one out as flex or grid drops the marker, and the fold read as an empty heading ("Build a
 * rule" in the Mind sheet, the agents page's manifests). Every stylesheet of the game and its pages here keeps a
 * summary a list item. (The circuits page, static/, is the other half of R68 and its own work.)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const SKIP = new Set(["static", "node_modules"]);

function sheets(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return SKIP.has(n) ? [] : sheets(p);
    return n.endsWith(".css") ? [p] : [];
  });
}

/** Each rule of a stylesheet that selects a summary itself (not its ::after or what is inside it), and its display. */
function summaryDisplays(css: string): Array<{ selector: string; display: string }> {
  const out: Array<{ selector: string; display: string }> = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim();
    const display = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim();
    if (!display) continue;
    const own = selector.split(",").some((s) => /summary\s*$/.test(s.trim()));
    if (own) out.push({ selector, display });
  }
  return out;
}

describe("every fold-out keeps its open marker (R68)", () => {
  it("no stylesheet lays a summary out as anything but a list item", () => {
    const bad = sheets(SRC).flatMap((f) =>
      summaryDisplays(readFileSync(f, "utf8"))
        .filter((r) => r.display !== "list-item")
        .map((r) => `${relative(SRC, f)}: ${r.selector} { display: ${r.display} }`),
    );
    expect(bad).toEqual([]);
  });

  it("the check finds the rule that dropped the marker", () => {
    expect(summaryDisplays(".build summary { cursor: pointer; display: flex; }")).toEqual([
      { selector: ".build summary", display: "flex" },
    ]);
    expect(summaryDisplays(".sheet summary::after { display: block }")).toEqual([]);
  });
});
