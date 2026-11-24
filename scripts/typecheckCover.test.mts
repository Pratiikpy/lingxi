/**
 * A36: the repo's own scripts and the browser suite are type-checked with everything else. Before, `pnpm typecheck`
 * covered the workspace packages only, and two type errors sat in `scripts/fork-tests.mts` unseen.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

/** Every file under `dir` whose name ends with one of `ends`, as repo paths. */
function filesIn(dir: string, ends: string[]): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        ends.some((x) => e.name.endsWith(x)) &&
        !/node_modules|[\\/]\.run[\\/]/.test(join(e.parentPath, e.name)),
    )
    .map((e) => relative(root, join(e.parentPath, e.name)).replace(/\\/g, "/"));
}

/** The files a type-check project reads, as repo paths. */
function project(dir: string): Set<string> {
  const r = spawnSync(process.execPath, [tsc, "-p", dir, "--listFilesOnly"], { cwd: root, encoding: "utf8" });
  return new Set(
    r.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((f) => relative(root, f).replace(/\\/g, "/")),
  );
}

describe("the type check covers the scripts and the browser suite (A36)", () => {
  it("reads every script and every file of the browser suite", () => {
    const scripts = project("scripts");
    expect(filesIn("scripts", [".mts"]).filter((f) => !scripts.has(f))).toEqual([]);
    const e2e = project("e2e");
    expect(filesIn("e2e", [".ts"]).filter((f) => !e2e.has(f))).toEqual([]);
  }, 120_000);

  it("is run by `pnpm typecheck`, and so by CI and the status check", () => {
    const typecheck = (
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }
    ).scripts.typecheck!;
    expect(typecheck).toContain("pnpm -r typecheck");
    expect(typecheck).toContain("tsc -p scripts");
    expect(typecheck).toContain("tsc -p e2e");
    expect(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")).toContain("run: pnpm typecheck");
    expect(readFileSync(join(root, "scripts/status-check.mts"), "utf8")).toContain('"pnpm", ["typecheck"]');
  });
});
