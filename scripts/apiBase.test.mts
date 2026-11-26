/**
 * R3: the game's server address (and its live rooms' address) is read in one place, apps/web/src/game/apiBase.ts. It was copied into 30 files, so a
 * change to how the address is chosen had 30 places to go wrong. No other file of the game's own code reads
 * VITE_API_URL or names the local server's address (comments may still speak of them).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const src = join(root, "apps", "web", "src");
const HOME = "game/apiBase.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** The code of a file with its comments taken out. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("the server address is read in one place (R3)", () => {
  const all = files(src).map((f) => relative(src, f).split("\\").join("/"));

  it("the one place reads it", () => {
    expect(all).toContain(HOME);
    expect(readFileSync(join(src, HOME), "utf8")).toMatch(/import\.meta\.env\.VITE_API_URL/);
  });

  it("no other file reads it or names the local server", () => {
    const others = all.filter(
      (f) => f !== HOME && /VITE_API_URL|VITE_LIVE_URL|localhost:8787/.test(code(readFileSync(join(src, f), "utf8"))),
    );
    expect(others).toEqual([]);
  });
});
