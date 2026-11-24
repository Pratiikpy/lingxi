/**
 * Every README image is taken from the live game by a script that records which build it showed (A100), so the status
 * check can tell when one shows what the game no longer has. The banner has its own source (`banner.html`, A86).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOTS_FILE } from "./lib/sites.mts";

const root = join(import.meta.dirname, "..");

describe("the README's images are taken from the live game (A100)", () => {
  it("every image the README shows is recorded with the build it was taken from", () => {
    const shots = JSON.parse(readFileSync(join(root, SHOTS_FILE), "utf8")) as Record<string, { commit: string }>;
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const shown = [...readme.matchAll(/docs\/readme\/([a-z0-9-]+\.png)/g)]
      .map((m) => m[1]!)
      .filter((f) => f !== "banner.png");
    expect(shown.length, "the README shows its images").toBeGreaterThan(4);
    for (const f of shown) expect(shots[f]?.commit, `${f} is recorded`).toMatch(/^[0-9a-f]{40}$/);
    for (const f of readdirSync(join(root, "docs", "readme")).filter(
      (n) => n.endsWith(".png") && n !== "banner.png" && n !== "banner-base.png",
    )) {
      expect(shown, `${f} is shown by the README`).toContain(f);
    }
  });
});
