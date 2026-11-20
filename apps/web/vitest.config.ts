import { defineConfig, mergeConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage";
import viteConfig from "./vite.config";

// a file's first test imports the whole game store fresh; on a two-core or busy machine that alone took over five
// seconds (A56), as the other packages' exhaustive checks do; a test that hangs still fails at this ceiling
export default mergeConfig(viteConfig, defineConfig({ test: { testTimeout: 30_000, coverage } }));
