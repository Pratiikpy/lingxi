/**
 * `pnpm site:release`: builds the site into a release folder of its own and makes it live in one step (A10). Nothing
 * the live site serves is touched until the new release is complete and checked; then the pointer is replaced, the
 * release before it is kept for a rollback, and releases that stopped being live more than 14 days ago are let go.
 *
 *   pnpm site:release                       build this commit and make it live (refused on uncommitted changes)
 *   pnpm site:release --allow-dirty         a rehearsal from uncommitted work (the release is named -dirty)
 *   pnpm site:release --rollback            make the release before the live one live again
 *   pnpm site:release --adopt <dist> [--kept <assets-kept>]   take a build made before releases as a release
 *   --site <dir>                            the releases folder (default apps/web/site, which the server serves)
 *
 * The build reads its settings from the environment, as `vite build` does; the live site is released with
 *   VITE_CHAIN=xlayer VITE_API_URL=https://lingxi.knole.me VITE_LIVE_URL=wss://lingxi.knole.me/live pnpm site:release
 */

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPointer, releasesDir } from "../services/api/src/releases.ts";
import { adopt, makeLive, prune, releaseName, rollback } from "./lib/release.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const site = resolve(value("--site") ?? join(root, "apps/web/site"));
const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();
const say = (line: string) => console.log(line);

function finish(): void {
  const removed = prune(site, Date.now());
  const live = readPointer(site);
  say(
    `live: ${live?.release}${live?.previous ? ` (the release before it, kept for a rollback: ${live.previous})` : ""}`,
  );
  if (removed.length) say(`let go, 14 days after they stopped being live: ${removed.join(", ")}`);
}

try {
  if (flag("--rollback")) {
    say(`rolled back to ${rollback(site, Date.now())}`);
    finish();
  } else if (value("--adopt")) {
    const kept = value("--kept");
    say(`adopted ${adopt(site, resolve(value("--adopt")!), kept ? resolve(kept) : null, Date.now())}`);
    finish();
  } else {
    const commit = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
    if (dirty && !flag("--allow-dirty"))
      throw new Error("uncommitted changes: a release is made from a commit (or say --allow-dirty for a rehearsal)");
    const name = releaseName(Date.now(), commit, dirty);
    const into = join(releasesDir(site), name);
    if (existsSync(into)) throw new Error(`release ${name} already exists`);
    say(`building ${name}`);
    const vite = join(root, "apps/web/node_modules/vite/bin/vite.js");
    const built = spawnSync(process.execPath, [vite, "build", "--outDir", into, "--emptyOutDir"], {
      cwd: join(root, "apps/web"),
      stdio: "inherit",
      env: process.env,
    });
    if (built.status !== 0) {
      rmSync(into, { recursive: true, force: true, maxRetries: 5 });
      throw new Error(`the build failed (exit ${built.status}); nothing was made live`);
    }
    try {
      makeLive(site, name, Date.now());
    } catch (e) {
      rmSync(into, { recursive: true, force: true, maxRetries: 5 });
      throw e;
    }
    finish();
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
