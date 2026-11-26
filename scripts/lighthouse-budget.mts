/**
 * `pnpm perf:lighthouse [site]`: Lighthouse (13.6.0, mobile, simulated slow 4G and a 4x slower CPU) on every page of a
 * built site served locally, each held to a floor (P3). The floor is 85 rather than the 90 the live site is held to: a
 * shared CI runner's scores move several points from run to run, and a floor that fails by chance teaches people to
 * ignore it; 85 still fails any real regression of the kind P3 removed (the game page was 61). Layout shift must stay
 * under 0.1 on every page. Chrome is Playwright's own, which CI installs for the browser suite.
 *
 * R19: a page is judged as Lighthouse advises for a number that varies, by the median of several runs. A page whose
 * first run passes is done; one whose first run does not is run twice more and judged by the median of the three, and
 * every run is printed, so a page that was slow once is seen to have been and a page that is slow fails
 * (scripts/lib/lighthouseVerdict.mts). `--only page.html` runs one page; `--runs N` runs each page N times whatever
 * the first says, to see how steady it is.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { type Run, moreRunsWanted, verdict } from "./lib/lighthouseVerdict.mts";

const FLOOR = 85;
const MAX_SHIFT = 0.1;
const PORT = 4183;
const LIGHTHOUSE = "lighthouse@13.6.0";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const only = flag("--only");
const forcedRuns = Number(flag("--runs") ?? 0);
const given = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
const site = resolve(given ?? join("apps", "web", "dist"));
const pages = readdirSync(site).filter(
  (f) => f.endsWith(".html") && readFileSync(join(site, f), "utf8").includes("<script") && (!only || f === only),
);
const out = mkdtempSync(join(tmpdir(), "lighthouse-"));

const server = spawn(
  process.execPath,
  [join("node_modules", "vite", "bin", "vite.js"), "preview", "--outDir", site, "--port", String(PORT), "--strictPort"],
  { cwd: resolve("apps", "web"), stdio: "ignore" },
);
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/index.html`)).ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the built site did not come up for Lighthouse");
};

const LIMITS = { floor: FLOOR, maxShift: MAX_SHIFT };

/** One Lighthouse run of a page, or what it said when it did not finish. */
function measure(page: string, n: number): Run | string {
  const file = join(out, `${page}.${n}.json`);
  const args = [
    "-y",
    LIGHTHOUSE,
    `http://localhost:${PORT}/${page}`,
    "--quiet",
    "--only-categories=performance",
    "--output=json",
    `--output-path=${file}`,
    "--chrome-flags=--headless=new --no-sandbox",
  ];
  // Windows runs npx through its shell (npx.cmd), which takes one command line (each argument with a space quoted) rather than an argument list
  const r = spawnSync(
    process.platform === "win32" ? ["npx", ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a}"` : a)).join(" ") : "npx",
    process.platform === "win32" ? [] : args,
    {
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      shell: process.platform === "win32",
      encoding: "utf8",
      timeout: 300_000,
    },
  );
  if (r.status !== 0) return (r.stdout + r.stderr).slice(-800);
  const report = JSON.parse(readFileSync(file, "utf8")) as {
    categories: { performance: { score: number } };
    audits: Record<string, { numericValue: number }>;
  };
  const a = report.audits;
  return {
    score: Math.round(report.categories.performance.score * 100),
    shift: a["cumulative-layout-shift"]!.numericValue,
    first: Math.round(a["first-contentful-paint"]!.numericValue),
    largest: Math.round(a["largest-contentful-paint"]!.numericValue),
    blocking: Math.round(a["total-blocking-time"]!.numericValue),
  };
}
const told = (r: Run) =>
  `${String(r.score).padStart(3)}  first paint ${r.first} ms, largest ${r.largest} ms, blocking ${r.blocking} ms, shift ${r.shift.toFixed(3)}`;

let failed = 0;
try {
  await up();
  for (const page of pages) {
    const runs: Run[] = [];
    let broke: string | null = null;
    const take = () => {
      const r = measure(page, runs.length + 1);
      if (typeof r === "string") broke = r;
      else runs.push(r);
    };
    take();
    // more runs when the first is below the floor (or as many as were asked for)
    while (!broke && runs.length < Math.max(forcedRuns, runs.length + moreRunsWanted(runs, LIMITS))) take();
    if (broke || !runs.length) {
      console.log(`FAILED    ${page}: Lighthouse did not finish\n${broke ?? ""}`);
      failed++;
      continue;
    }
    const v = verdict(runs, LIMITS);
    if (v.bad) failed++;
    if (runs.length > 1) runs.forEach((r, i) => console.log(`  run ${i + 1}   ${page.padEnd(16)} ${told(r)}`));
    console.log(
      `${v.bad ? "BELOW    " : "ok       "} ${page.padEnd(16)} ${told(v.median)}${runs.length > 1 ? `  (the median of ${runs.length} runs${v.unsteady ? "; UNSTEADY: its largest paint moved by more than 2 s between them" : ""})` : ""}`,
    );
  }
} finally {
  server.kill();
}
if (failed) {
  console.error(`${failed} page(s) below the floor of ${FLOOR} or shifting`);
  process.exit(1);
}
