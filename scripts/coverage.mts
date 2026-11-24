/**
 * `pnpm coverage`: how much of each part's code its tests run, held to at least 80% of lines and of branches (P2, N5).
 * - the rules (`packages/brain`, `packages/game`, `packages/world`): their unit tests;
 * - the game's four stores (`store.ts`, `world.ts`, `chain.ts`, `saveRuntime.ts` in `apps/web/src/game`): the web
 *   package's tests; the rest of the game's folder is browser glue the end-to-end suite runs for real;
 * - the server (`services/api`): its unit tests and its fork tests, on a pinned fork (`scripts/fork-tests.mts`);
 * - the contracts: `forge coverage` on a fork of X Layer (reads only), each contract on its own.
 * The thresholds live in each package's vitest config (`vitest.coverage.ts`); the contracts' are checked here, since
 * forge has none. Exits non-zero when any part falls short, after printing every part's numbers.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BAR = 80;
const vitest = join(root, "node_modules/vitest/vitest.mjs");
/**
 * Coverage instruments every line, and the simulation suites run several times slower under it: on CI the game's
 * balance setup passed its 480 s limit while it takes 106 s uninstrumented (P6b). Each suite's long limits and its
 * defaults are multiplied by this (tests' slow(), the packages' vitest configs); a plain run is unchanged.
 */
const SLOWED = { ...process.env, LINGXI_SLOW_TESTS: "5" };

const rows: Array<{ part: string; lines: number; branches: number; ok: boolean }> = [];

/** Reads the totals vitest wrote (`json-summary`) after a run in `dir`. */
const totals = (dir: string) => (JSON.parse(readFileSync(join(dir, "coverage/coverage-summary.json"), "utf8")) as { total: { lines: { pct: number }; branches: { pct: number } } }).total;

for (const pkg of ["packages/brain", "packages/game", "packages/world"]) {
  const run = spawnSync(process.execPath, [vitest, "run", "--coverage"], { env: SLOWED, cwd: join(root, pkg), stdio: ["ignore", "ignore", "inherit"] });
  const t = totals(join(root, pkg));
  rows.push({ part: pkg, lines: t.lines.pct, branches: t.branches.pct, ok: run.status === 0 });
}

{
  // the game's stores: the bar is given here, since the web package's config is its build's
  const stores = ["store", "world", "chain", "saveRuntime"].map((f) => `--coverage.include=src/game/${f}.ts`);
  const run = spawnSync(process.execPath, [vitest, "run", "--coverage", "--coverage.provider=v8", ...stores, `--coverage.thresholds.lines=${BAR}`, `--coverage.thresholds.branches=${BAR}`, "--coverage.reporter=json-summary", "--coverage.reporter=text-summary"], { env: SLOWED, cwd: join(root, "apps/web"), stdio: ["ignore", "ignore", "inherit"] });
  const t = totals(join(root, "apps/web"));
  rows.push({ part: "apps/web game stores", lines: t.lines.pct, branches: t.branches.pct, ok: run.status === 0 });
}

{
  // the server, with its fork tests switched on; its config holds the bar (the chain package's fork tests run in CI's
  // check job, and are not part of this measure)
  const run = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/fork-tests.mts", "--only", "services/api", "--coverage"], { env: SLOWED, cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  const t = totals(join(root, "services/api"));
  rows.push({ part: "services/api (with fork tests)", lines: t.lines.pct, branches: t.branches.pct, ok: run.status === 0 });
}

{
  // invariant tests are left out of this one run: on a fork their fuzzing looks up so many accounts that the public
  // node refuses them (HTTP 403); `forge test` runs them as always
  const run = spawnSync("forge", ["coverage", "--fork-url", "xlayer", "--no-match-test", "invariant", "--report", "summary"], { cwd: join(root, "contracts"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const lines = (run.stdout ?? "").split("\n").filter((l) => /^\| src\//.test(l));
  if (run.status !== 0 || !lines.length) rows.push({ part: "contracts", lines: 0, branches: 0, ok: false });
  for (const l of lines) {
    const cells = l.split("|").map((c) => c.trim());
    const pct = (cell: string) => Number(/^([\d.]+)%/.exec(cell)?.[1] ?? 0);
    // columns: file, lines, statements, branches, functions
    const [file, linesCell, , branchesCell] = cells.slice(1);
    const lp = pct(linesCell!);
    const bp = pct(branchesCell!);
    rows.push({ part: `contracts/${file}`, lines: lp, branches: bp, ok: lp >= BAR && bp >= BAR });
  }
}

const width = Math.max(...rows.map((r) => r.part.length));
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.part.padEnd(width)}  lines ${r.lines.toFixed(1).padStart(5)}%  branches ${r.branches.toFixed(1).padStart(5)}%`);
const short = rows.filter((r) => !r.ok);
console.log(short.length ? `\n${short.length} part(s) below ${BAR}% of lines or branches, or not measured` : `\nevery part at or above ${BAR}% of lines and branches`);
process.exitCode = short.length ? 1 : 0;
