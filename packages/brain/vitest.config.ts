import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage";

// several checks here are exhaustive (every input, thousands of beats, restarts with key derivation) and take seconds
// on a two-core CI runner; a test that hangs still fails at this ceiling
export default defineConfig({ test: { testTimeout: 30_000 * (Number(process.env.LINGXI_SLOW_TESTS) || 1), hookTimeout: 10_000 * (Number(process.env.LINGXI_SLOW_TESTS) || 1), coverage } });
