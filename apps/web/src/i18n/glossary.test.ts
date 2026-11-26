/**
 * P6: no shown text uses a word the glossary rules out (glossary.ts). Every page, the game, the world's characters
 * and the static pages are read; a hit names the file, the line and the word to use instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";

const repo = join(import.meta.dirname, "..", "..", "..", "..");
const SOURCES = [
  "apps/web/src",
  "packages/world/src",
  "packages/game/src",
  "apps/web/404.html",
  "apps/web/circuits.html",
  "scripts/lib/shareCards.mts",
];

function files(path: string): string[] {
  const full = join(repo, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(tsx?|mts|html)$/.test(f) && !/\.test\.|glossary\.ts$/.test(f) && !f.includes("node_modules"))
    .map((f) => join(full, f));
}

const texts = SOURCES.flatMap(files).map((f) => ({
  file: relative(repo, f).split("\\").join("/"),
  lines: readFileSync(f, "utf8").split("\n"),
}));

describe("the glossary (P6)", () => {
  it("reads the game's text", () => {
    expect(texts.length).toBeGreaterThan(100);
  });

  for (const term of GLOSSARY) {
    const ruledOut = [
      ...(term.notZh ?? []).map((r) => ({ r, use: term.zh })),
      ...(term.notEn ?? []).map((r) => ({ r, use: term.en })),
    ];
    if (ruledOut.length === 0) continue;
    it(`"${term.en}" is "${term.zh}" in Chinese, one word each way`, () => {
      const hits: string[] = [];
      for (const { file, lines } of texts)
        lines.forEach((line, i) => {
          for (const { r, use } of ruledOut)
            if (r.test(line)) hits.push(`${file}:${i + 1}: ${line.match(r)?.[0]} (use ${use})`);
        });
      expect(hits).toEqual([]);
    });
  }

  it("names each term once", () => {
    const zh = GLOSSARY.map((t) => t.zh);
    expect(new Set(zh).size).toBe(zh.length);
  });
});
