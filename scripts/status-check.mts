/**
 * `pnpm status:check` — the real state of Lingxi in one run, nothing taken on trust.
 *
 *   code       type check (packages, scripts, browser suite), lint, every package's tests, the contract tests
 *              (and, without --quick, the mainnet fork tests, which only read X Layer)
 *   hygiene    the repo carries no names it must not, no machine-made commit trailers, no secrets
 *   promises   the balance targets, the 90-day simulator and the claims sheet, once each exists
 *   sites      the live site and the on-chain copy serve the commit checked out here, built clean
 *   plan       when the workspace plan sits beside the repo: one row in progress, every done row proven
 *
 * Each line is PASS, FAIL or PENDING (a check whose subject is not built yet). The run fails on any
 * FAIL; with --release a PENDING fails it too, because nothing may be handed in unbuilt. The on-chain copy is published
 * once per milestone, so between closes it may lag and is PENDING; `--milestone` (and `--release`) require it current.
 *
 *   pnpm status:check [--quick] [--milestone] [--release] [--only code,sites]
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasBannedName, scanNames } from "../packages/world/src/names.ts";
import { retryNote, steadyFetch } from "./lib/steadyFetch.mts";
import { SERVER_INPUTS, SHOTS_FILE, SITE_INPUTS, currentness, onChainFile, parseBuild } from "./lib/sites.mts";
import { LINGXI_SITE } from "../packages/chain/src/site.ts";

type Verdict = "PASS" | "FAIL" | "PENDING";
interface Result {
  group: string;
  name: string;
  verdict: Verdict;
  detail: string;
  ms: number;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const release = args.includes("--release");
/** at a milestone's close the on-chain copy must be current too (between closes it is published once per milestone) */
const milestone = args.includes("--milestone") || release;
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? (onlyArg.includes("=") ? onlyArg.split("=")[1]! : args[args.indexOf(onlyArg) + 1]!).split(",")
  : null;

const LIVE = process.env.LINGXI_LIVE_URL ?? LINGXI_SITE;
/** The live server on this machine, answered directly: only it gives the health detail (A64). */
const LOCAL_API = process.env.LINGXI_LOCAL_API ?? "http://127.0.0.1:8790";
const DEWEB_URL = process.env.LINGXI_DEWEB_URL ?? "https://1-2-419.tapekit.org";
const PLAN = process.env.LINGXI_PLAN ?? join(root, "..", "40-MASTER-PLAN.md");
const STATUS = process.env.LINGXI_BUILD_STATUS ?? join(root, "..", "BUILD-STATUS.md");
const TAIL_LINES = 25;

const results: Result[] = [];

function record(group: string, name: string, verdict: Verdict, detail: string, started: number): void {
  const r = { group, name, verdict, detail, ms: Date.now() - started };
  results.push(r);
  const secs = (r.ms / 1000).toFixed(1).padStart(6);
  console.log(`${verdict.padEnd(7)} ${secs}s  [${group}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Runs a command to completion; on failure the last lines of its output say why. */
function run(cmd: string, cmdArgs: string[], cwd = root, timeoutMs = 30 * 60_000): { ok: boolean; out: string } {
  // one command line through the shell, so Windows finds pnpm.cmd; every argument here is our own, never input
  const line = [cmd, ...cmdArgs.map((a) => (/[\s*'"]/.test(a) ? `"${a}"` : a))].join(" ");
  const p = spawnSync(line, { cwd, encoding: "utf8", shell: true, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  const out = `${p.stdout ?? ""}${p.stderr ?? ""}`;
  if (p.error) return { ok: false, out: `${out}\n${p.error.message}` };
  return { ok: p.status === 0, out };
}

function tail(out: string): string {
  return out
    .trim()
    .split(/\r?\n/)
    .slice(-TAIL_LINES)
    .map((l) => `          ${l}`)
    .join("\n");
}

/** Where a failing step's whole output is kept, so a failure that does not come back can still be read. */
const LOGS = join(tmpdir(), "lingxi-status-check");

function step(group: string, name: string, cmd: string, cmdArgs: string[], cwd = root): void {
  const t = Date.now();
  const { ok, out } = run(cmd, cmdArgs, cwd);
  record(group, name, ok ? "PASS" : "FAIL", "", t);
  if (ok) return;
  console.log(tail(out));
  mkdirSync(LOGS, { recursive: true });
  const log = join(LOGS, `${new Date(t).toISOString().replace(/[:.]/g, "-")}-${name.replace(/[^a-z0-9]+/gi, "-")}.log`);
  writeFileSync(log, out);
  console.log(`          the whole output: ${log}`);
}

function wanted(group: string): boolean {
  return !only || only.includes(group);
}

function git(...gitArgs: string[]): string {
  const p = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`git ${gitArgs.join(" ")}: ${p.stderr}`);
  return p.stdout;
}

// ---------------------------------------------------------------- code

function codeChecks(): void {
  // every package, the repo's own scripts and the browser suite (A36)
  step("code", "type check, every package, the scripts and the browser suite", "pnpm", ["typecheck"]);
  step("code", "lint", "pnpm", ["lint"]);
  step("code", "tests, every package", "pnpm", ["-r", "test"]);
  step("code", "contract tests", "forge", ["test"], join(root, "contracts"));
  step("code", "README numbers match the repo", "pnpm", [
    "exec",
    "tsx",
    "scripts/readme-facts.mts",
    "--check",
    ...(quick ? ["--no-tests"] : []),
  ]);
  if (quick) {
    record("code", "contract tests on a mainnet fork", "PENDING", "skipped by --quick", Date.now());
  } else {
    step(
      "code",
      "contract tests on a mainnet fork (reads X Layer only)",
      "forge",
      ["test", "--fork-url", "xlayer", "--match-path", "test/*.fork.t.sol"],
      join(root, "contracts"),
    );
  }
}

// ---------------------------------------------------------------- hygiene

const TRAILERS = [/^Co-Authored-By:/im, /^Claude-Session:/im, /Generated with \[?Claude/i];
const SECRET = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b0x[0-9a-fA-F]{64}\b(?=[^\n]*(?:key|secret|private|mnemonic))/i,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}/,
];
/** Files read as bytes, not text. */
const BINARY = /\.(png|jpe?g|gif|webp|wav|mp3|ogg|mp4|webm|wasm|bin|woff2?|ttf|ico)$/i;
/** Lockfiles: generated, and their integrity hashes are random letters that can spell anything. */
const LOCKFILE = /(^|\/)pnpm-lock\.yaml$/;
/** Third-party code we vendor and do not edit; their own text is theirs. */
const VENDORED = /^contracts\/lib\//;

function hygieneChecks(): void {
  const files = git("ls-files")
    .split("\n")
    .filter((f) => f && !VENDORED.test(f));

  let t = Date.now();
  const named = files.filter((f) => hasBannedName(f));
  const inside: string[] = [];
  for (const f of files) {
    const path = join(root, f);
    if (!existsSync(path) || BINARY.test(f) || LOCKFILE.test(f)) continue;
    const text = readFileSync(path, "utf8");
    const hit = scanNames(text, 1)[0];
    if (hit) inside.push(`${f}:${hit.line} "${hit.context}"`);
  }
  const hits = [...named.map((f) => `file name ${f}`), ...inside];
  record(
    "hygiene",
    "no source-game names in tracked files",
    hits.length ? "FAIL" : "PASS",
    hits.length ? `${hits.length} files, first: ${hits.slice(0, 8).join("; ")}` : `${files.length} files`,
    t,
  );

  t = Date.now();
  const messages = git("log", "--all", "--format=%H%x00%an <%ae>%x00%B%x01")
    .split("\x01")
    .filter((m) => m.trim());
  const bad = messages.filter(
    (m) => TRAILERS.some((re) => re.test(m)) || scanNames(m.split("\x00")[2] ?? "", 1).length > 0,
  );
  const authors = new Set(messages.map((m) => m.split("\x00")[1]!.trim()));
  record(
    "hygiene",
    "commit messages carry no AI trailers or forbidden names",
    bad.length ? "FAIL" : "PASS",
    bad.length
      ? `${bad.length} of ${messages.length} commits, first ${bad[0]!.trim().slice(0, 12)}`
      : `${messages.length} commits`,
    t,
  );
  record(
    "hygiene",
    "one public author identity",
    authors.size === 1 ? "PASS" : "FAIL",
    [...authors].map((a) => a.replace(/<.*>/, "<…>")).join(", "),
    Date.now(),
  );

  t = Date.now();
  const leaks: string[] = [];
  for (const f of files) {
    const path = join(root, f);
    if (!existsSync(path) || BINARY.test(f)) continue;
    if (/(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)) leaks.push(`${f} (env file tracked)`);
    const text = readFileSync(path, "utf8");
    const hit = SECRET.find((re) => re.test(text));
    if (hit) leaks.push(`${f} (${hit.source.slice(0, 24)}…)`);
  }
  record("hygiene", "no secrets in tracked files", leaks.length ? "FAIL" : "PASS", leaks.slice(0, 5).join("; "), t);
}

// ---------------------------------------------------------------- promises

/** A check whose subject is still to be built: PENDING until its script exists, then it must pass. */
function promised(name: string, script: string, cmd: string, cmdArgs: string[], cwd = root): void {
  if (!existsSync(join(root, script))) {
    record("promises", name, "PENDING", `not built yet (${script})`, Date.now());
    return;
  }
  step("promises", name, cmd, cmdArgs, cwd);
}

function promiseChecks(): void {
  promised("balance targets", "packages/game/test/balance.test.ts", "pnpm", [
    "--filter",
    "@lingxi/game",
    "exec",
    "vitest",
    "run",
    "test/balance.test.ts",
  ]);
  promised("the 90-day simulator inside its targets", "packages/game/scripts/sim90.ts", "pnpm", [
    "--filter",
    "@lingxi/game",
    "exec",
    "tsx",
    "scripts/sim90.ts",
    "--check",
  ]);
  promised("every public claim checked", "scripts/claims-check.mts", "pnpm", [
    "exec",
    "tsx",
    "scripts/claims-check.mts",
    ...(milestone ? ["--milestone"] : []),
  ]);
}

// ---------------------------------------------------------------- sites

// what each site is built from, and the on-chain reader, are shared with the claims check (scripts/lib/sites.mts, A85)

async function served(base: string): Promise<{ commit: string; dirty: boolean; builtAt: string } | string> {
  try {
    let text: string;
    if (base === DEWEB_URL) text = await onChainFile(root, "build.json");
    else {
      const { res: r } = await steadyFetch(`${base}/build.json`, { headers: { "cache-control": "no-cache" } });
      if (!r.ok) return `HTTP ${r.status} for /build.json`;
      text = await r.text();
    }
    return parseBuild(text);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function siteChecks(): Promise<void> {
  const head = git("rev-parse", "HEAD").trim();
  const dirty = git("status", "--porcelain", "--untracked-files=no").trim().length > 0;
  record(
    "sites",
    "this checkout is committed",
    dirty ? "FAIL" : "PASS",
    dirty ? "uncommitted changes: a site cannot be serving them honestly" : head.slice(0, 12),
    Date.now(),
  );

  for (const [name, base] of [
    ["live site", LIVE],
    ["on-chain copy (read from X Layer)", DEWEB_URL],
  ] as const) {
    const t = Date.now();
    const s = await served(base);
    if (typeof s === "string") {
      record("sites", `${name} serves this commit`, "FAIL", `${base}: ${s}`, t);
      continue;
    }
    // a site built from an older commit is still current when nothing it is made of changed since
    const inputs = base === DEWEB_URL ? SITE_INPUTS : [...SITE_INPUTS, ...SERVER_INPUTS];
    const { current: same, why } = currentness(
      s,
      head,
      (commit) => spawnSync("git", ["diff", "--quiet", commit, head, "--", ...inputs], { cwd: root }).status === 0,
    );
    // the on-chain copy is published at the end of each milestone (about 0.01 OKB a time, see the plan), so between
    // those it may lag; it is pending then, and a failure at a milestone's close or a release
    const lagsByDesign = !same && base === DEWEB_URL && !s.dirty && !milestone;
    record(
      "sites",
      `${name} is current`,
      same ? "PASS" : lagsByDesign ? "PENDING" : "FAIL",
      lagsByDesign ? `${why} (published at the milestone's close)` : why,
      t,
    );
  }

  // the README's images show the game as it is (A100): each was taken from a live build (`pnpm readme:shots` and
  // `pnpm readme:phones` record which), and nothing it shows may have changed since; retaken at each milestone's close
  {
    const t = Date.now();
    let shots: Record<string, { commit: string }> = {};
    try {
      shots = JSON.parse(readFileSync(join(root, SHOTS_FILE), "utf8")) as typeof shots;
    } catch {
      // none recorded
    }
    const taken = ["proof.png", "numbers.png", "tree.png", "play.png", "world.png", "chain.png"];
    const missing = taken.filter((f) => !shots[f]);
    const stale = taken.filter(
      (f) =>
        shots[f] &&
        !currentness(
          { commit: shots[f].commit, dirty: false, builtAt: "" },
          head,
          (c) => spawnSync("git", ["diff", "--quiet", c, head, "--", ...SITE_INPUTS], { cwd: root }).status === 0,
        ).current,
    );
    const why = missing.length
      ? `not recorded as taken from a live build: ${missing.join(", ")}`
      : stale.length
        ? `taken from a build the game has changed since: ${stale.join(", ")} (retake with pnpm readme:shots / readme:phones)`
        : `all ${taken.length} taken from a build the game has not changed since`;
    record(
      "sites",
      "README images show the current game",
      missing.length ? "FAIL" : !stale.length ? "PASS" : milestone ? "FAIL" : "PENDING",
      why,
      t,
    );
  }

  const t = Date.now();
  try {
    // the switches through the tunnel, as the world sees them; the detail only from this machine directly (A64)
    const { res: r, retried } = await steadyFetch(`${LIVE}/api/health`);
    const pub = (await r.json()) as Record<string, unknown>;
    const local = (await (await fetch(`${LOCAL_API}/api/health`, { signal: AbortSignal.timeout(20_000) })).json()) as {
      detail?: unknown;
    };
    if (pub.detail !== undefined)
      throw new Error("the public health answer carries its detail: it must go to this machine only");
    const j = { ...pub, detail: local.detail } as Record<string, unknown> & {
      detail?: {
        jobs?: Record<string, string>;
        relayerOkb?: number | null;
        relayerLow?: boolean;
        relayerBem?: number | null;
        relayerBemTapeouts?: number | null;
        relayerBemLow?: boolean;
        indexerLagBlocks?: number | null;
        backup?: { ageHours: number; local: boolean; drive: boolean; error: string | null } | null;
        watchdog?: { ageSeconds: number } | null;
      };
    };
    // the switches are booleans; every background job must also be healthy
    const down = Object.entries(j)
      .filter(([k, v]) => k !== "detail" && v !== true)
      .map(([k]) => k);
    const failing = Object.entries(j.detail?.jobs ?? {})
      .filter(([, v]) => v !== "ok")
      .map(([k, v]) => `${k} ${v}`);
    // a day's backup must have reached both places, and the relayer must not be running low
    const b = j.detail?.backup;
    if (j.detail && (!b || b.ageHours > 26 || !b.local || !b.drive))
      failing.push(
        `backup ${b ? `${b.ageHours}h old, local ${b.local}, drive ${b.drive}${b.error ? `: ${b.error}` : ""}` : "never ran"}`,
      );
    if (j.detail?.relayerLow) failing.push(`relayer low: ${j.detail.relayerOkb} OKB`);
    // the processor takes the transistor fee in BEM: below ten tape-outs' worth, players would soon be refused (A40)
    if (j.detail?.relayerBemLow)
      failing.push(`relayer's BEM low: ${j.detail.relayerBem} BEM, ${j.detail.relayerBemTapeouts} tape-outs' fees`);
    // the watchdog beats every minute; three minutes without one means nothing is watching the site
    const wd = j.detail?.watchdog;
    if (j.detail && (!wd || wd.ageSeconds > 180))
      failing.push(`watchdog ${wd ? `silent for ${wd.ageSeconds}s` : "not running"}`);
    const facts = `${j.detail ? `; relayer ${j.detail.relayerOkb ?? "?"} OKB and ${j.detail.relayerBem ?? "?"} BEM (${j.detail.relayerBemTapeouts ?? "?"} tape-outs' fees), indexer ${j.detail.indexerLagBlocks ?? "?"} blocks behind` : ""}${retried.length ? `; ${retryNote("health", retried)}` : ""}`;
    // P3b: the server runs from a build; that build must come from this checkout, or from a commit whose server code
    // (the server, its packages, its settings) has not changed since
    const sb = (local.detail as { server?: { commit: string; dirty: boolean; builtAt: string } | "source" } | undefined)
      ?.server;
    const serverInputs = [
      ...SERVER_INPUTS,
      ...["brain", "game", "world", "art", "send", "chain"].map((p) => `packages/${p}/src`),
      "pnpm-lock.yaml",
      ":(exclude)**/*.test.ts",
    ];
    if (!sb)
      record(
        "sites",
        "live server runs this checkout's server code",
        "FAIL",
        "the server does not say which build it runs",
        t,
      );
    else if (sb === "source")
      record(
        "sites",
        "live server runs this checkout's server code",
        "FAIL",
        "it runs from source through tsx, not from its build (pnpm server:release)",
        t,
      );
    else {
      const head = git("rev-parse", "HEAD").trim();
      const { current, why } = currentness(
        sb,
        head,
        (commit) =>
          spawnSync("git", ["diff", "--quiet", commit, head, "--", ...serverInputs], { cwd: root }).status === 0,
      );
      record(
        "sites",
        "live server runs this checkout's server code",
        current ? "PASS" : "FAIL",
        current ? why : `${why} (pnpm server:release)`,
        t,
      );
    }
    record(
      "sites",
      "live server's parts and jobs are all up",
      r.ok && !down.length && !failing.length ? "PASS" : "FAIL",
      [down.length ? `down: ${down.join(", ")}` : "", failing.length ? `failing: ${failing.join("; ")}` : ""]
        .filter(Boolean)
        .join(" ") || `${Object.keys(j.detail?.jobs ?? {}).length} jobs ok${facts}`,
      t,
    );
  } catch (e) {
    record("sites", "live server's parts are all up", "FAIL", e instanceof Error ? e.message : String(e), t);
  }
}

// ---------------------------------------------------------------- plan

interface Row {
  id: string;
  status: string;
}

function planChecks(): void {
  if (!existsSync(PLAN)) {
    record("plan", "workspace plan", "PENDING", `no plan file at ${PLAN} (set LINGXI_PLAN)`, Date.now());
    return;
  }
  const t = Date.now();
  const rows: Row[] = readFileSync(PLAN, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\|\s*([A-Z]\d+[a-z]?)\s*\|[^|]*\|\s*(.*?)\s*\|\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1]!, status: m[2]! }));
  const inProgress = rows.filter((r) => /in progress/i.test(r.status));
  record(
    "plan",
    "at most one row in progress",
    inProgress.length <= 1 ? "PASS" : "FAIL",
    `${rows.length} rows; in progress: ${inProgress.map((r) => r.id).join(", ") || "none"}`,
    t,
  );

  const proof = existsSync(STATUS) ? readFileSync(STATUS, "utf8") : "";
  const done = rows.filter((r) => /^done\b/i.test(r.status));
  const unproven = done.filter((r) => {
    const section = /section\s+(\d+)/i.exec(r.status)?.[1];
    return !section || !new RegExp(`^#{1,4}\\s*${section}[.\\s]`, "m").test(proof);
  });
  record(
    "plan",
    "every done row names its proof section, and the section exists",
    unproven.length ? "FAIL" : "PASS",
    unproven.length ? `unproven: ${unproven.map((r) => r.id).join(", ")}` : `${done.length} done`,
    Date.now(),
  );

  // every done row has a patch that undoes it and the test that must then fail, or its reason for none is written down
  // (scripts/regressions/without.json), so the README's sentence about them stays true (A106)
  {
    const pairs = new Set(
      (JSON.parse(readFileSync(join(root, "scripts/regressions/list.json"), "utf8")) as Array<{ row: string }>).map(
        (e) => e.row,
      ),
    );
    const without = JSON.parse(readFileSync(join(root, "scripts/regressions/without.json"), "utf8")) as Record<
      string,
      string
    >;
    const bare = done.filter((r) => /^A\d+$/.test(r.id) && !pairs.has(r.id) && !without[r.id]).map((r) => r.id);
    record(
      "plan",
      "every done row has a revert pair, or a reason for none",
      bare.length ? "FAIL" : "PASS",
      bare.length
        ? `no pair and no reason: ${bare.join(", ")}`
        : `${Object.keys(without).length} rows without a pair, each with its reason`,
      Date.now(),
    );
  }

  // a row is closed when done, waiting on Prateek, set for later, or dropped by Prateek's own decision (which the row
  // must say, so nothing is dropped quietly)
  const open = rows.filter(
    (r) => !/^(done|waiting|later)\b/i.test(r.status) && !/^dropped\b.*\bby Prateek\b/i.test(r.status),
  );
  record("plan", "rows still open", open.length ? "PENDING" : "PASS", open.map((r) => r.id).join(" "), Date.now());
}

// ---------------------------------------------------------------- run

console.log(`Lingxi status at ${new Date().toISOString()}${quick ? " (quick)" : ""}${release ? " (release)" : ""}\n`);
if (wanted("code")) codeChecks();
if (wanted("hygiene")) hygieneChecks();
if (wanted("promises")) promiseChecks();
if (wanted("sites")) await siteChecks();
if (wanted("plan")) planChecks();

const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
const failed = count("FAIL") + (release ? count("PENDING") : 0);
console.log(
  `\n${count("PASS")} pass, ${count("FAIL")} fail, ${count("PENDING")} pending${failed ? " — NOT GREEN" : " — green"}`,
);
process.exit(failed ? 1 : 0);
