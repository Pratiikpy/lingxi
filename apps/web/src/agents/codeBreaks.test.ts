import { describe, expect, it } from "vitest";
import { codePieces } from "./codeBreaks";

/** the pieces of a line as text, with "|" where a line may break */
const shown = (line: string) =>
  codePieces(line)
    .map((p) => (p.url ? p.parts.join("|") : p.text))
    .join("");

describe("where an address in a code sample may break (R25)", () => {
  it("breaks an address after a slash, and before ? and &", () => {
    expect(shown("GET https://lingxi.knole.me/api/v1/spar?chips=punish,block,bite&vs=pip&seed=7")).toBe(
      "GET https://lingxi.knole.me/|api/|v1/|spar|?chips=punish,block,bite|&vs=pip|&seed=7",
    );
  });

  it("never breaks inside the scheme's double slash, nor after it", () => {
    expect(shown("https://a.b/c")).toBe("https://a.b/|c");
    expect(shown("x //not/a/url")).toBe("x //not/a/url");
  });

  it("finds an address inside quotes and after an option", () => {
    expect(shown(`curl -s "https://x.y/a?b=1"`)).toBe(`curl -s "https://x.y/|a|?b=1"`);
    expect(shown(`"--package=https://github.com/o/r/v1.tgz",`)).toBe(`"--package=https://github.com/|o/|r/|v1.tgz",`);
  });

  it("leaves a line with no address as it is, and keeps every character", () => {
    expect(shown(`  -d '{"action":"feed"}'`)).toBe(`  -d '{"action":"feed"}'`);
    const line = `curl -X POST https://lingxi.knole.me/api/v1/agents/me/season -H "authorization: Bearer $TOKEN" \\`;
    expect(
      codePieces(line)
        .map((p) => (p.url ? p.parts.join("") : p.text))
        .join(""),
    ).toBe(line);
  });

  it("does not end an address with a slash it cannot break after", () => {
    expect(shown("https://x.y/")).toBe("https://x.y/");
    expect(shown("")).toBe("");
  });
});
