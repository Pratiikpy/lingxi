/**
 * R42: the server's release refuses uncommitted changes, as the site's does. The guard is run for real on a scratch
 * git repository: a clean tree passes, a changed tracked file is refused (and named), an untracked file is not the
 * release's business, and `--allow-dirty` lets a rehearsal through. The release command runs the guard first.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const guard = join(root, "deploy", "releaseGuard.mjs");
const repo = mkdtempSync(join(tmpdir(), "lingxi-guard-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
const run = (...a: string[]) => spawnSync(process.execPath, [guard, "--cwd", repo, ...a], { encoding: "utf8" });

describe("the server's release is made from a commit (R42)", () => {
  git("init", "-q");
  git("config", "user.email", "guard@example.invalid");
  git("config", "user.name", "guard");
  writeFileSync(join(repo, "server.ts"), "export const a = 1;\n");
  git("add", "server.ts");
  git("commit", "-q", "-m", "first");

  it("a clean tree passes", () => {
    expect(run().status).toBe(0);
  });

  it("an untracked file is not the release's business", () => {
    writeFileSync(join(repo, "scratch.txt"), "notes\n");
    expect(run().status).toBe(0);
  });

  it("a changed tracked file is refused and named; --allow-dirty lets a rehearsal through", () => {
    writeFileSync(join(repo, "server.ts"), "export const a = 2;\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("uncommitted changes");
    expect(r.stderr).toContain("server.ts");
    expect(run("--allow-dirty").status).toBe(0);
  });

  it("the release command runs the guard before it builds", () => {
    const scripts = (
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts["server:release"]).toMatch(/^node deploy\/releaseGuard\.mjs && pnpm --filter @lingxi\/api build/);
  });
});
