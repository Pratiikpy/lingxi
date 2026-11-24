/**
 * `pnpm --filter @lingxi/api build`: the server as plain JavaScript in services/api/dist (P3b). Run through tsx, every
 * start transpiled the server and its packages first, which on a machine short of memory took about four minutes while
 * the site was down; the built server starts without that step.
 *
 * Four entry points: the server, and each worker under the name of the boot file the server starts it by
 * (`new URL("./xBoot.mjs", import.meta.url)`): from the source, a boot file registers tsx and imports the worker's
 * TypeScript; beside the built server, the boot file is the built worker itself. dist sits at the same depth as src, so
 * every path the server resolves from its own file (deployments, snapshots, mail, data, secrets) is the same.
 * Everything is bundled but Node's own modules and two optional native helpers of ws.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const api = resolve(import.meta.dirname, "..");

/** Builds the server and its workers into `out` (dist by default; the tests build into a folder of their own). */
export async function buildServer(out = join(api, "dist")): Promise<string> {
  rmSync(out, { recursive: true, force: true });
  await build({
    absWorkingDir: api,
    entryPoints: {
      server: "src/server.ts",
      logHashBoot: "src/logHashWork.ts",
      mindBoot: "src/mindWork.ts",
      standingsBoot: "src/standingsWork.ts",
    },
    outdir: out,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    sourcemap: "linked",
    legalComments: "linked",
    // ws loads these only when they are installed, and they are not
    external: ["bufferutil", "utf-8-validate"],
    // bundled CommonJS packages call require; ESM output has none of its own
    banner: { js: 'import { createRequire as __lingxiRequire } from "node:module"; const require = __lingxiRequire(import.meta.url);' },
    logLevel: "warning",
  });
  // the commit the build came from, which the running server reports in its health detail and the status check
  // compares with the checkout (a built server could otherwise run code older than the repo without anyone seeing)
  const git = (...args: string[]) => execFileSync("git", args, { cwd: api, encoding: "utf8" }).trim();
  let commit = "unknown";
  let dirty = true;
  try {
    commit = git("rev-parse", "HEAD");
    dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
  } catch {
    console.warn("no git checkout: the server's build.json records an unknown commit");
  }
  writeFileSync(join(out, "build.json"), `${JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() })}
`);
  return out;
}

/**
 * Builds beside the running server, then puts the new build in place of the old in one rename, so a server still on the
 * old build never finds half a new one; the caller reloads the server straight after (`pnpm server:release`).
 */
export async function releaseServer(): Promise<string> {
  const dist = join(api, "dist");
  const next = await buildServer(join(api, "dist-next"));
  rmSync(dist, { recursive: true, force: true });
  renameSync(next, dist);
  return dist;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) console.log(`server built: ${await releaseServer()}`);
