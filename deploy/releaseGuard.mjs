/**
 * R42: a release of the server is made from a commit. `pnpm server:release` built the server from the working tree,
 * so a release made while other work was under way put that work's uncommitted edits on the live server (2026-11-27:
 * health said commit d1e7e0a, dirty). Run first in the release: it refuses, as the site's release does, when a tracked
 * file differs from the commit, unless `--allow-dirty` asks for a rehearsal. Untracked files are not the release's
 * business (the site's release reads the tree the same way).
 *
 *   node deploy/releaseGuard.mjs [--allow-dirty] [--cwd <folder>]
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const at = args.indexOf("--cwd");
const cwd = at >= 0 ? args[at + 1] : process.cwd();

const changed = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
if (changed.length && !args.includes("--allow-dirty")) {
  process.stderr.write(
    `uncommitted changes: a release is made from a commit (or say --allow-dirty for a rehearsal)\n${changed
      .slice(0, 10)
      .map((l) => `  ${l}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  changed.length ? "releasing uncommitted work, as asked (--allow-dirty)\n" : "the tree is the commit\n",
);
