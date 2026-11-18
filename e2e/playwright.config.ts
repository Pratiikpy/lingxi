/**
 * The end-to-end suite: `pnpm e2e`. It starts a fork of X Layer at a pinned block, the server and the game (see
 * harness/run.ts), plays each flow in a fresh browser as a player would, and stops everything after. Specs run one at
 * a time: they share one chain. A failure keeps its trace, screenshot and video; nothing is retried, because a flow
 * that passes only sometimes is a defect to explain, not to hide.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "specs",
  globalSetup: "./global-setup.ts",
  outputDir: "../test-results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
  },
});
