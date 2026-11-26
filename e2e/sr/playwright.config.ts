/**
 * R8: the screen-reader run, `pnpm e2e:sr`. NVDA (Guidepup's packaged build, installed with
 * `npx @guidepup/setup install`) reads the live game while the keyboard plays it, and every phrase it speaks is kept.
 * It runs on Windows only, in a headed browser that must hold the screen's focus, so it is run on demand and not in
 * CI. LINGXI_SR_URL points it at another copy of the game (the live site by default).
 */
import { defineConfig, devices } from "@playwright/test";
import { withGuidepup } from "@guidepup/playwright";

export default withGuidepup(
  defineConfig({
    testDir: ".",
    testMatch: /\.sr\.ts$/,
    // its own folder: the browser suite empties test-results when it starts, and took a run's transcripts with it
    outputDir: "../../test-results-sr",
    retries: 0,
    timeout: 900_000,
    expect: { timeout: 20_000 },
    reporter: [["list"]],
    use: { ...devices["Desktop Chrome"], trace: "retain-on-failure", screenshot: "only-on-failure" },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  }),
);
