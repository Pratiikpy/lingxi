/**
 * The final review: English text is set in Noto Sans SC's Latin, whose curly quotes are drawn full width (as Chinese
 * wants them), so English quotes stood apart with wide gaps. On an English page the quote marks come from a Latin face;
 * a Chinese page keeps its own. Measured in a browser: the English opening quote 8.3 px wide, against 22 px before.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "apps", "web", "src", "styles", "tokens.css"), "utf8");

describe("quote marks in English are Latin ones", () => {
  it("a Latin face is declared for the curly quotes alone", () => {
    expect(css).toMatch(/font-family: "Lingxi Latin Quotes";[\s\S]{0,200}unicode-range: U\+2018-201F;/);
  });
  it("an English page puts it first in the body's faces, and a Chinese page does not", () => {
    expect(css).toMatch(/html:lang\(en\) \{\s*--body:\s*"Lingxi Latin Quotes", "Noto Sans SC"/);
    expect(css).toMatch(/--body: "Noto Sans SC"/);
  });
});
