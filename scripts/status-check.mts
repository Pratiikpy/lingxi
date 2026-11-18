/**
 * `pnpm status:check` — the real state of Lingxi in one run, nothing taken on trust.
 *
 *   code       type check, lint, every package's tests, the contract tests (and, without --quick, the
 *              mainnet fork tests, which only read X Layer)
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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, type Address, type Hex, hexToString } from "viem";
import { hasBannedName, scanNames } from "../packages/world/src/names.ts";

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
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1]! : args[args.indexOf(onlyArg) + 1]!).split(",") : null;

const LIVE = process.env.LINGXI_LIVE_URL ?? "https://lingxi.knole.me";
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
  return out.trim().split(/\r?\n/).slice(-TAIL_LINES).map((l) => `          ${l}`).join("\n");
}

function step(group: string, name: string, cmd: string, cmdArgs: string[], cwd = root): void {
  const t = Date.now();
  const { ok, out } = run(cmd, cmdArgs, cwd);
  record(group, name, ok ? "PASS" : "FAIL", "", t);
  if (!ok) console.log(tail(out));
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
  step("code", "type check, every package", "pnpm", ["-r", "typecheck"]);
  step("code", "lint", "pnpm", ["lint"]);
  step("code", "tests, every package", "pnpm", ["-r", "test"]);
  step("code", "contract tests", "forge", ["test"], join(root, "contracts"));
  step("code", "README numbers match the repo", "pnpm", ["exec", "tsx", "scripts/readme-facts.mts", "--check", ...(quick ? ["--no-tests"] : [])]);
  if (quick) {
    record("code", "contract tests on a mainnet fork", "PENDING", "skipped by --quick", Date.now());
  } else {
    step("code", "contract tests on a mainnet fork (reads X Layer only)", "forge", ["test", "--fork-url", "xlayer", "--match-path", "test/*.fork.t.sol"], join(root, "contracts"));
  }
}

// ---------------------------------------------------------------- hygiene

const TRAILERS = [/^Co-Authored-By:/im, /^Claude-Session:/im, /Generated with \[?Claude/i];
const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b0x[0-9a-fA-F]{64}\b(?=[^\n]*(?:key|secret|private|mnemonic))/i, /\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9]{32,}/];
/** Files read as bytes, not text. */
const BINARY = /\.(png|jpe?g|gif|webp|wav|mp3|ogg|mp4|webm|wasm|bin|woff2?|ttf|ico)$/i;
/** Lockfiles: generated, and their integrity hashes are random letters that can spell anything. */
const LOCKFILE = /(^|\/)pnpm-lock\.yaml$/;
/** Third-party code we vendor and do not edit; their own text is theirs. */
const VENDORED = /^contracts\/lib\//;

function hygieneChecks(): void {
  const files = git("ls-files").split("\n").filter((f) => f && !VENDORED.test(f));

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
  record("hygiene", "no source-game names in tracked files", hits.length ? "FAIL" : "PASS", hits.length ? `${hits.length} files, first: ${hits.slice(0, 8).join("; ")}` : `${files.length} files`, t);

  t = Date.now();
  const messages = git("log", "--all", "--format=%H%x00%an <%ae>%x00%B%x01").split("\x01").filter((m) => m.trim());
  const bad = messages.filter((m) => TRAILERS.some((re) => re.test(m)) || scanNames(m.split("\x00")[2] ?? "", 1).length > 0);
  const authors = new Set(messages.map((m) => m.split("\x00")[1]!.trim()));
  record("hygiene", "commit messages carry no AI trailers or forbidden names", bad.length ? "FAIL" : "PASS", bad.length ? `${bad.length} of ${messages.length} commits, first ${bad[0]!.trim().slice(0, 12)}` : `${messages.length} commits`, t);
  record("hygiene", "one public author identity", authors.size === 1 ? "PASS" : "FAIL", [...authors].map((a) => a.replace(/<.*>/, "<…>")).join(", "), Date.now());

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
  promised("balance targets", "packages/game/test/balance.test.ts", "pnpm", ["--filter", "@lingxi/game", "exec", "vitest", "run", "test/balance.test.ts"]);
  promised("the 90-day simulator inside its targets", "packages/game/scripts/sim90.ts", "pnpm", ["--filter", "@lingxi/game", "exec", "tsx", "scripts/sim90.ts", "--check"]);
  promised("every public claim checked", "scripts/claims-check.mts", "pnpm", ["exec", "tsx", "scripts/claims-check.mts"]);
}

// ---------------------------------------------------------------- sites

/** What a site's build is made of: a change anywhere here means it must be rebuilt and published. */
const SITE_INPUTS = [
  "apps/web/src", "apps/web/public", "apps/web/*.html", "apps/web/vite.config.ts", "apps/web/package.json", "apps/web/scripts",
  ...["brain", "game", "world", "art", "send", "handheld", "chain"].flatMap((p) => [`packages/${p}/src`, `packages/${p}/package.json`]),
  "packages/handheld/wasm", "packages/chain/deployments", "pnpm-lock.yaml",
  ":(exclude)**/*.test.ts", ":(exclude)**/*.test.tsx",
];
/** And the live server's own code and settings. */
const SERVER_INPUTS = ["services/api/src", "services/api/package.json", "deploy"];

/** DeWEB keeps each file on chain; the gateway answers a plain request with its own loader, so read the file itself. */
const DEWEB = { opener: "0x536adD8F30f03b69f6fbF29d425A816A0dC50106", sites: "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6", circuit: 1n } as const;
async function onChainFile(path: string): Promise<string> {
  const deployment = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as { processor: Address };
  const pub = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 20_000 }) });
  const container = (await pub.readContract({ address: DEWEB.opener, abi: parseAbi(["function accountOf(address circuits, uint256 tokenId) view returns (address)"]), functionName: "accountOf", args: [deployment.processor, DEWEB.circuit] })) as Address;
  const bytes = (await pub.readContract({ address: DEWEB.sites, abi: parseAbi(["function readRange(address container, string path, uint256 offset, uint256 length) view returns (bytes)"]), functionName: "readRange", args: [container, path, 0n, 4096n] })) as Hex;
  return hexToString(bytes);
}

async function served(base: string): Promise<{ commit: string; dirty: boolean; builtAt: string } | string> {
  try {
    let text: string;
    if (base === DEWEB_URL) text = await onChainFile("build.json");
    else {
      const r = await fetch(`${base}/build.json`, { signal: AbortSignal.timeout(20_000), headers: { "cache-control": "no-cache" } });
      if (!r.ok) return `HTTP ${r.status} for /build.json`;
      text = await r.text();
    }
    const j = JSON.parse(text) as { commit?: unknown; dirty?: unknown; builtAt?: unknown };
    if (typeof j.commit !== "string") return "build.json has no commit";
    return { commit: j.commit, dirty: j.dirty === true, builtAt: String(j.builtAt) };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function siteChecks(): Promise<void> {
  const head = git("rev-parse", "HEAD").trim();
  const dirty = git("status", "--porcelain", "--untracked-files=no").trim().length > 0;
  record("sites", "this checkout is committed", dirty ? "FAIL" : "PASS", dirty ? "uncommitted changes: a site cannot be serving them honestly" : head.slice(0, 12), Date.now());

  for (const [name, base] of [["live site", LIVE], ["on-chain copy (read from X Layer)", DEWEB_URL]] as const) {
    const t = Date.now();
    const s = await served(base);
    if (typeof s === "string") {
      record("sites", `${name} serves this commit`, "FAIL", `${base}: ${s}`, t);
      continue;
    }
    // a site built from an older commit is still current when nothing it is made of changed since
    const inputs = base === DEWEB_URL ? SITE_INPUTS : [...SITE_INPUTS, ...SERVER_INPUTS];
    const unchanged = s.commit === head || (!s.dirty && spawnSync("git", ["diff", "--quiet", s.commit, head, "--", ...inputs], { cwd: root }).status === 0);
    const same = !s.dirty && unchanged;
    const why = s.dirty
      ? `built from uncommitted changes on top of ${s.commit.slice(0, 12)}`
      : s.commit === head
        ? `serves ${s.commit.slice(0, 12)}, built ${s.builtAt}`
        : unchanged
          ? `serves ${s.commit.slice(0, 12)}; nothing it is built from has changed since`
          : `serves ${s.commit.slice(0, 12)}, and what it is built from changed since: redeploy`;
    // the on-chain copy is published at the end of each milestone (about 0.01 OKB a time, see the plan), so between
    // those it may lag; it is pending then, and a failure at a milestone's close or a release
    const lagsByDesign = !same && base === DEWEB_URL && !s.dirty && !milestone;
    record("sites", `${name} is current`, same ? "PASS" : lagsByDesign ? "PENDING" : "FAIL", lagsByDesign ? `${why} (published at the milestone's close)` : why, t);
  }

  const t = Date.now();
  try {
    const r = await fetch(`${LIVE}/api/health`, { signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as Record<string, unknown> & {
      detail?: { jobs?: Record<string, string>; relayerOkb?: number | null; relayerLow?: boolean; indexerLagBlocks?: number | null; backup?: { ageHours: number; local: boolean; drive: boolean; error: string | null } | null; watchdog?: { ageSeconds: number } | null };
    };
    // the switches are booleans; every background job must also be healthy
    const down = Object.entries(j).filter(([k, v]) => k !== "detail" && v !== true).map(([k]) => k);
    const failing = Object.entries(j.detail?.jobs ?? {}).filter(([, v]) => v !== "ok").map(([k, v]) => `${k} ${v}`);
    // a day's backup must have reached both places, and the relayer must not be running low
    const b = j.detail?.backup;
    if (j.detail && (!b || b.ageHours > 26 || !b.local || !b.drive)) failing.push(`backup ${b ? `${b.ageHours}h old, local ${b.local}, drive ${b.drive}${b.error ? `: ${b.error}` : ""}` : "never ran"}`);
    if (j.detail?.relayerLow) failing.push(`relayer low: ${j.detail.relayerOkb} OKB`);
    // the watchdog beats every minute; three minutes without one means nothing is watching the site
    const wd = j.detail?.watchdog;
    if (j.detail && (!wd || wd.ageSeconds > 180)) failing.push(`watchdog ${wd ? `silent for ${wd.ageSeconds}s` : "not running"}`);
    const facts = j.detail ? `; relayer ${j.detail.relayerOkb ?? "?"} OKB, indexer ${j.detail.indexerLagBlocks ?? "?"} blocks behind` : "";
    record("sites", "live server's parts and jobs are all up", r.ok && !down.length && !failing.length ? "PASS" : "FAIL", [down.length ? `down: ${down.join(", ")}` : "", failing.length ? `failing: ${failing.join("; ")}` : ""].filter(Boolean).join(" ") || `${Object.keys(j.detail?.jobs ?? {}).length} jobs ok${facts}`, t);
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
    .map((l) => /^\|\s*([A-Z]\d+)\s*\|[^|]*\|\s*(.*?)\s*\|\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1]!, status: m[2]! }));
  const inProgress = rows.filter((r) => /in progress/i.test(r.status));
  record("plan", "at most one row in progress", inProgress.length <= 1 ? "PASS" : "FAIL", `${rows.length} rows; in progress: ${inProgress.map((r) => r.id).join(", ") || "none"}`, t);

  const proof = existsSync(STATUS) ? readFileSync(STATUS, "utf8") : "";
  const done = rows.filter((r) => /^done\b/i.test(r.status));
  const unproven = done.filter((r) => {
    const section = /section\s+(\d+)/i.exec(r.status)?.[1];
    return !section || !new RegExp(`^#{1,4}\\s*${section}[.\\s]`, "m").test(proof);
  });
  record("plan", "every done row names its proof section, and the section exists", unproven.length ? "FAIL" : "PASS", unproven.length ? `unproven: ${unproven.map((r) => r.id).join(", ")}` : `${done.length} done`, Date.now());

  const open = rows.filter((r) => !/^(done|waiting|later)\b/i.test(r.status));
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
console.log(`\n${count("PASS")} pass, ${count("FAIL")} fail, ${count("PENDING")} pending${failed ? " — NOT GREEN" : " — green"}`);
process.exit(failed ? 1 : 0);
