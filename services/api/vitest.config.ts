import { defineConfig } from "vitest/config";

// several checks here are exhaustive (every input, thousands of beats, restarts with key derivation) and take seconds
// on a two-core CI runner; a test that hangs still fails at this ceiling
export default defineConfig({ test: { testTimeout: 30_000 } });
