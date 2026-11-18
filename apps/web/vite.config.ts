import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { hasBannedName, scanNames } from "../../packages/world/src/names";
import { keepAssetsPlugin } from "./keepAssets";

/** build.json beside the pages: the commit a build came from, so anyone can check what a site is serving. */
function buildStamp(): Plugin {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
  return {
    name: "lingxi-build-stamp",
    generateBundle() {
      let commit = "unknown";
      let dirty = true;
      try {
        commit = git("rev-parse", "HEAD");
        dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
      } catch {
        this.warn("no git checkout: build.json records an unknown commit");
      }
      this.emitFile({ type: "asset", fileName: "build.json", source: `${JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() })}\n` });
    },
  };
}

/** The build fails if a name the project must never carry reached its output, in a file's name or its text. */
function namesGuard(): Plugin {
  let outDir = "";
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  return {
    name: "lingxi-names-guard",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const found: string[] = [];
      for (const f of walk(outDir)) {
        const rel = relative(outDir, f).split("\\").join("/");
        if (hasBannedName(rel)) found.push(`file name ${rel}`);
        else if (/\.(js|css|html|json|svg|webmanifest|txt|map)$/.test(f)) {
          const hit = scanNames(readFileSync(f, "utf8"), 1)[0];
          if (hit) found.push(`${rel}:${hit.line} "${hit.context}"`);
        }
      }
      if (found.length) throw new Error(`a banned name reached the build output:\n  ${found.slice(0, 20).join("\n  ")}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildStamp(), namesGuard(), keepAssetsPlugin()],
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: { index: resolve(__dirname, "index.html"), play: resolve(__dirname, "play.html"), verify: resolve(__dirname, "verify.html"), agents: resolve(__dirname, "agents.html"), tree: resolve(__dirname, "tree.html"), numbers: resolve(__dirname, "numbers.html"), handheld: resolve(__dirname, "handheld.html") },
    },
  },
  // the end-to-end suite (e2e/) plays a dev server that must not reload a page under a running test when a file is
  // saved; its reload channel stays, since Vite uses it to reload a page after bundling a newly found dependency
  // under the suite it also transforms the game's source as it starts, so a dependency it finds is bundled before any
  // test loads a page (a cold CI machine otherwise found one mid-load, and the page could not load)
  server: { port: 5199, ...(process.env.LINGXI_E2E === "1" ? { watch: null, warmup: { clientFiles: ["./src/**/main.tsx", "./src/**/*.tsx", "!./src/**/*.test.tsx"] } } : {}) },
  // the end-to-end suite gives each run its own dependency cache, so runs never share one and each starts as CI does
  ...(process.env.LINGXI_VITE_CACHE ? { cacheDir: process.env.LINGXI_VITE_CACHE } : {}),
});
