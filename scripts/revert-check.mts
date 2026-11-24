/**
 * `pnpm revert:check`: every bug the audits found and we fixed has a test that would catch it coming back. For each
 * fix listed in `scripts/regressions/list.json`, in a scratch git worktree of HEAD: its named test passes on the code
 * as it is, then the fix is undone with its patch (`scripts/regressions/<id>.patch`, written by hand to take out what
 * the fix put in and nothing else) and the same test must fail. Anything else fails the check, and says why: a test
 * that stays green has stopped guarding its fix; a patch that no longer applies means the fixed code moved and the
 * patch must follow it; a revert that no longer builds proves nothing.
 *
 *   pnpm revert:check [--only <id>[,<id>]] [--changed <commit>] [--list] [--keep]
 *
 * `--list` names the entries that would run and stops; `--keep` leaves the worktree for a look.
 *
 * `--changed <commit>` (CI, on a push) checks only the entries added or changed in the list since that commit and those
 * whose patch changed; all of them when the commit is not known here (a new branch). See `lib/revertSelect.mts`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changedEntries } from "./lib/revertSelect.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listFile = join(root, "scripts/regressions/list.json");

export type TestRef =
  /** a vitest test, by its package folder, file and the start of its name */
  | { kind: "vitest"; dir: string; file: string; name: string }
  /** an end-to-end spec, by file and title filter (it starts its own fork, server and game) */
  | { kind: "e2e"; spec: string; title: string }
  /** a contract test, by `forge test --match-test` */
  | { kind: "forge"; match: string };

export interface Regression {
  id: string;
  /** the plan row that fixed it */
  row: string;
  /** what was wrong, in a line */
  bug: string;
  test: TestRef;
}

type Outcome =
  | "guarded"
  | "unguarded"
  | "test-fails-on-clean-code"
  | "patch-does-not-apply"
  | "revert-does-not-build"
  | "test-not-found";

const sh = (cmd: string, args: string[], cwd: string) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
/** pnpm is a script shim on Windows, run through the shell as one command; its arguments here are fixed words */
const pnpm = (args: string[], cwd: string) =>
  process.platform === "win32"
    ? spawnSync(`pnpm ${args.join(" ")}`, { cwd, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 })
    : sh("pnpm", args, cwd);
/** a package's own command-line tool, run by this Node with no shell between, so a test's name reaches it as written */
const tool = (wt: string, bin: string, args: string[], cwd: string) =>
  sh(process.execPath, [join(wt, "node_modules", bin), ...args], cwd);

/** Runs one test in the worktree: "pass", "fail" (it ran and failed), "missing" (no such test), or "broken" (the file did not load). */
function runTest(wt: string, t: TestRef): { result: "pass" | "fail" | "missing" | "broken"; detail: string } {
  if (t.kind === "vitest") {
    const out = join(wt, ".revert-check-result.json");
    rmSync(out, { force: true });
    // -t takes a pattern: the name is matched as written
    const pattern = t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const r = tool(
      wt,
      "vitest/vitest.mjs",
      ["run", t.file, "-t", pattern, "--reporter=json", `--outputFile=${out}`],
      join(wt, t.dir),
    );
    if (!existsSync(out)) return { result: "broken", detail: (r.stderr || r.stdout).split("\n").slice(-8).join("\n") };
    const report = JSON.parse(readFileSync(out, "utf8")) as {
      testResults: Array<{
        status: string;
        message?: string;
        assertionResults: Array<{ title: string; fullName: string; status: string }>;
      }>;
    };
    const file = report.testResults[0];
    if (!file) return { result: "missing", detail: "no test file ran" };
    const ran = file.assertionResults.filter(
      (a) =>
        a.status !== "skipped" && a.status !== "pending" && (a.title.startsWith(t.name) || a.fullName.includes(t.name)),
    );
    if (!ran.length)
      return {
        result: file.status === "failed" && !file.assertionResults.length ? "broken" : "missing",
        detail: file.message?.split("\n").slice(0, 6).join("\n") ?? `no test named "${t.name}"`,
      };
    const failed = ran.filter((a) => a.status === "failed");
    return failed.length
      ? { result: "fail", detail: failed.map((a) => a.title).join("; ") }
      : { result: "pass", detail: ran.map((a) => a.title).join("; ") };
  }
  if (t.kind === "e2e") {
    const r = tool(
      wt,
      "@playwright/test/cli.js",
      [
        "test",
        "-c",
        "e2e/playwright.config.ts",
        t.spec,
        "-g",
        t.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "--reporter=list",
      ],
      wt,
    );
    const text = `${r.stdout}\n${r.stderr}`;
    if (/No tests found/i.test(text)) return { result: "missing", detail: text.split("\n").slice(-6).join("\n") };
    if (/did not come up|Error: Cannot find module|SyntaxError/.test(text) && !/\d+ (passed|failed)/.test(text))
      return { result: "broken", detail: text.split("\n").slice(-12).join("\n") };
    return r.status === 0
      ? { result: "pass", detail: "" }
      : {
          result: "fail",
          detail: text
            .split("\n")
            .filter((l) => /✘|Error:/.test(l))
            .slice(0, 4)
            .join("\n"),
        };
  }
  const r = sh("forge", ["test", "--match-test", t.match], join(wt, "contracts"));
  const text = `${r.stdout}\n${r.stderr}`;
  if (/No tests match/i.test(text)) return { result: "missing", detail: text.slice(-400) };
  if (/Compiler run failed|Error \(\d+\)/.test(text)) return { result: "broken", detail: text.slice(-600) };
  return r.status === 0
    ? { result: "pass", detail: "" }
    : {
        result: "fail",
        detail: text
          .split("\n")
          .filter((l) => /\[FAIL/.test(l))
          .join("\n"),
      };
}

function check(wt: string, reg: Regression): { outcome: Outcome; detail: string } {
  const patch = join(root, "scripts/regressions", `${reg.id}.patch`);
  execFileSync("git", ["checkout", "--", "."], { cwd: wt });
  execFileSync("git", ["clean", "-fdq", "-e", "node_modules"], { cwd: wt });
  const clean = runTest(wt, reg.test);
  if (clean.result === "missing") return { outcome: "test-not-found", detail: clean.detail };
  if (clean.result !== "pass") return { outcome: "test-fails-on-clean-code", detail: clean.detail };
  const applied = sh("git", ["apply", "--whitespace=nowarn", patch], wt);
  if (applied.status !== 0) return { outcome: "patch-does-not-apply", detail: applied.stderr.trim() };
  const reverted = runTest(wt, reg.test);
  execFileSync("git", ["checkout", "--", "."], { cwd: wt });
  if (reverted.result === "broken") return { outcome: "revert-does-not-build", detail: reverted.detail };
  if (reverted.result === "fail") return { outcome: "guarded", detail: reverted.detail };
  return { outcome: "unguarded", detail: reverted.detail || "the test still passes with the fix undone" };
}

/** The list as it stood at `commit`, and the files changed since; null when that commit is not known here. */
function since(commit: string): { before: Regression[]; files: string[] } | null {
  // a push to a new branch names an all-zero "before"; a commit this clone does not have is not known either
  const found = /^0+$/.test(commit)
    ? null
    : sh("git", ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], root);
  if (!found || found.status !== 0) return null;
  const sha = found.stdout.trim();
  const old = sh("git", ["show", `${sha}:scripts/regressions/list.json`], root);
  const files = sh("git", ["diff", "--name-only", sha, "HEAD"], root).stdout.split(/\r?\n/).filter(Boolean);
  return { before: old.status === 0 ? (JSON.parse(old.stdout) as Regression[]) : [], files };
}

function main(): void {
  const valueOf = (flag: string) =>
    process.argv.includes(flag) ? (process.argv[process.argv.indexOf(flag) + 1] ?? "") : null;
  const only = valueOf("--only")?.split(",") ?? null;
  const changed = valueOf("--changed");
  const all = JSON.parse(readFileSync(listFile, "utf8")) as Regression[];
  let list = all.filter((r) => !only || only.includes(r.id));
  if (changed !== null) {
    const base = since(changed);
    list = changedEntries(base?.before ?? null, list, base?.files ?? []);
    // on stderr, so `--list` prints only the ids
    console.error(
      base
        ? `entries added or changed since ${changed.slice(0, 12)}: ${list.map((r) => r.id).join(", ") || "none"}`
        : `${changed || "no commit"} is not known here: every entry`,
    );
    if (!list.length) return;
  }
  // `--list`: say which entries would run, and stop
  if (process.argv.includes("--list")) return void console.log(list.map((r) => r.id).join(" "));
  for (const r of list)
    if (!existsSync(join(root, "scripts/regressions", `${r.id}.patch`))) throw new Error(`${r.id}: no patch file`);
  const wt = mkdtempSync(join(tmpdir(), "lingxi-revert-"));
  execFileSync("git", ["worktree", "add", "--detach", wt, "HEAD"], { cwd: root, stdio: "ignore" });
  try {
    // the worktree shares the package store, so this links rather than downloads
    const install = pnpm(["install", "--frozen-lockfile", "--prefer-offline"], wt);
    if (install.status !== 0) throw new Error(`pnpm install in the worktree failed:\n${install.stderr.slice(-800)}`);
    let bad = 0;
    for (const reg of list) {
      const t0 = Date.now();
      const { outcome, detail } = check(wt, reg);
      if (outcome !== "guarded") bad++;
      console.log(
        `${outcome === "guarded" ? "PASS" : "FAIL"}  ${reg.id.padEnd(28)} ${outcome.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(0)}s  ${reg.bug}`,
      );
      if (outcome !== "guarded" && detail)
        console.log(
          detail
            .split("\n")
            .map((l) => `      ${l}`)
            .join("\n"),
        );
    }
    console.log(`\n${list.length - bad} of ${list.length} fixes guarded by a test that fails without them`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    if (!process.argv.includes("--keep")) {
      // removed by Node first: git cannot delete the package store's deep paths on Windows; then git forgets it
      rmSync(wt, { recursive: true, force: true, maxRetries: 3 });
      execFileSync("git", ["worktree", "prune"], { cwd: root, stdio: "ignore" });
    } else console.log(`worktree kept: ${wt}`);
  }
}

main();
