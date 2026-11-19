import type { CoverageOptions } from "vitest/node";

/**
 * The bar each package is held to when coverage is measured (`pnpm coverage`, and CI): at least 80% of the lines and of
 * the branches of its source, or the run fails (P2, N5). Plain `vitest run` measures nothing and is not slowed.
 */
export const coverage: CoverageOptions = {
  provider: "v8",
  include: ["src/**"],
  exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  thresholds: { lines: 80, branches: 80 },
  reporter: ["text-summary", "json-summary"],
};
