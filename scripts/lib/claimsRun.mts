/**
 * How the claims checker runs a row's evidence (A56), apart from the checker so it can be tested (A87). Everything
 * that touches the machine (files, processes) comes in `RunDeps`.
 */
import { posix } from "node:path";

export interface RunDeps {
  /** the repository's root, with forward slashes */
  root: string;
  exists: (path: string) => boolean;
  read: (path: string) => string;
  /** runs a command; its exit status and standard output */
  spawn: (cmd: string, args: string[], cwd: string) => { status: number | null; stdout: string };
  /** whether `dir` holds a package.json */
  hasPackage: (dir: string) => boolean;
}

export type Step = { ok: boolean; what: string };

/** A judge row passes only on the judge-check step it names; a judge run that stopped fails every judge row. */
export function judgeVerdict(steps: readonly Step[], arg: string): { ok: boolean; text: string } {
  if (!arg) return { ok: false, text: "a judge row must name its judge-check step" };
  const passed = steps.filter((l) => l.ok && l.what.includes(arg));
  const failed = steps.filter((l) => !l.ok && (l.what.includes(arg) || l.what.startsWith("judge-check stopped")));
  return {
    ok: passed.length > 0 && !failed.length,
    text: failed[0]?.what ?? passed[0]?.what ?? `no judge-check step mentions "${arg}"`,
  };
}

/**
 * A test row runs its test: a vitest file in its own package, a Foundry test by its path; a browser spec needs the
 * fork harness, so it counts only when CI's latest completed run on master passed its browser jobs with the spec in
 * that commit, and is otherwise pending.
 */
export function runTest(path: string, deps: RunDeps): { ok: boolean; why: string } | "pending" {
  const full = `${deps.root}/${path}`;
  if (!deps.exists(full)) return { ok: false, why: "does not exist" };
  if (/\.t\.sol$/.test(path)) {
    // a fork test skips itself off X Layer, so fork contracts run against a fork of mainnet and the others offline;
    // each pass counts only if tests ran and none was skipped (a skipped suite is not a passed one)
    const file = path.replace(/^contracts\//, "");
    const whole = /\.fork\.t\.sol$/.test(path);
    const mixed = !whole && /ForkTest\b/.test(deps.read(full));
    const forge = (args: string[]) => {
      const r = deps.spawn("forge", ["test", "--match-path", file, ...args], `${deps.root}/contracts`);
      const tally = /(\d+) tests passed, (\d+) failed, (\d+) skipped/.exec(r.stdout);
      const [ran, bad, skipped] = tally ? tally.slice(1).map(Number) : [0, 0, 0];
      return {
        ok: r.status === 0 && ran! > 0 && bad === 0 && skipped === 0,
        why: tally ? `${ran} passed, ${bad} failed, ${skipped} skipped` : `did not run (exit ${r.status})`,
      };
    };
    // rpc.xlayer.tech: xlayerrpc.okx.com refuses the block hashes a test asks for once it rolls past the chain's head
    const onFork = ["--fork-url", "https://rpc.xlayer.tech"];
    const passes = whole
      ? [{ name: "on a fork", ...forge(onFork) }]
      : mixed
        ? [
            { name: "offline", ...forge(["--offline", "--no-match-contract", "ForkTest"]) },
            { name: "on a fork", ...forge([...onFork, "--match-contract", "ForkTest"]) },
          ]
        : [{ name: "offline", ...forge(["--offline"]) }];
    return { ok: passes.every((x) => x.ok), why: `forge ${passes.map((x) => `${x.name}: ${x.why}`).join("; ")}` };
  }
  if (/\.spec\.ts$/.test(path)) {
    // the latest run that finished: a run cancelled by a newer push proves nothing either way
    const gh = deps.spawn(
      "gh",
      [
        "run",
        "list",
        "--workflow",
        "ci.yml",
        "--branch",
        "master",
        "--status",
        "completed",
        "--limit",
        "20",
        "--json",
        "databaseId,headSha,conclusion",
      ],
      deps.root,
    );
    const run = (
      JSON.parse(gh.stdout || "[]") as Array<{ databaseId: number; headSha: string; conclusion: string }>
    ).find((x) => x.conclusion === "success" || x.conclusion === "failure");
    if (!run) return "pending";
    // the browser suite runs in parts ("e2e 1 of 3" …): every part must have passed
    const jobs = deps.spawn(
      "gh",
      [
        "run",
        "view",
        String(run.databaseId),
        "--json",
        "jobs",
        "--jq",
        '.jobs[] | select(.name|startswith("e2e")) | .conclusion',
      ],
      deps.root,
    );
    const parts = jobs.stdout.trim().split(/\s+/).filter(Boolean);
    const inCommit = deps.spawn("git", ["cat-file", "-e", `${run.headSha}:${path}`], deps.root).status === 0;
    if (!parts.length || parts.some((x) => x !== "success") || !inCommit) return "pending";
    return { ok: true, why: `CI's browser job passed on ${run.headSha.slice(0, 7)} with this spec` };
  }
  // a vitest file: run it in the package that owns it
  let dir = posix.dirname(full);
  while (!deps.hasPackage(dir) && dir.length > deps.root.length) dir = posix.dirname(dir);
  const rel = full.slice(dir.length + 1);
  const r = deps.spawn(process.execPath, [`${deps.root}/node_modules/vitest/vitest.mjs`, "run", rel], dir);
  const summary =
    r.stdout
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split(/\r?\n/)
      .find((l) => /Tests\s+\d/.test(l))
      ?.trim() ?? `exit ${r.status}`;
  return { ok: r.status === 0, why: summary };
}
