/**
 * `pnpm perf:lighthouse [site]`: Lighthouse (13.6.0, mobile, simulated slow 4G and a 4x slower CPU) on every page of a
 * built site served locally, each held to a floor (P3). The floor is 85 rather than the 90 the live site is held to: a
 * shared CI runner's scores move several points from run to run, and a floor that fails by chance teaches people to
 * ignore it; 85 still fails any real regression of the kind P3 removed (the game page was 61). Layout shift must stay
 * under 0.1 on every page. Chrome is Playwright's own, which CI installs for the browser suite.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const FLOOR = 85;
const MAX_SHIFT = 0.1;
const PORT = 4183;
const LIGHTHOUSE = "lighthouse@13.6.0";

const site = resolve(process.argv[2] ?? join("apps", "web", "dist"));
const pages = readdirSync(site).filter((f) => f.endsWith(".html") && readFileSync(join(site, f), "utf8").includes("<script"));
const out = mkdtempSync(join(tmpdir(), "lighthouse-"));

const server = spawn(process.execPath, [join("node_modules", "vite", "bin", "vite.js"), "preview", "--outDir", site, "--port", String(PORT), "--strictPort"], { cwd: resolve("apps", "web"), stdio: "ignore" });
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

let failed = 0;
try {
  await up();
  for (const page of pages) {
    const file = join(out, `${page}.json`);
    const r = spawnSync("npx", ["-y", LIGHTHOUSE, `http://localhost:${PORT}/${page}`, "--quiet", "--only-categories=performance", "--output=json", `--output-path=${file}`, "--chrome-flags=--headless=new --no-sandbox"], {
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      shell: process.platform === "win32",
      encoding: "utf8",
      timeout: 300_000,
    });
    if (r.status !== 0) {
      console.log(`FAILED    ${page}: Lighthouse did not finish\n${(r.stdout + r.stderr).slice(-800)}`);
      failed++;
      continue;
    }
    const report = JSON.parse(readFileSync(file, "utf8")) as { categories: { performance: { score: number } }; audits: Record<string, { numericValue: number }> };
    const score = Math.round(report.categories.performance.score * 100);
    const a = report.audits;
    const shift = a["cumulative-layout-shift"]!.numericValue;
    const bad = score < FLOOR || shift >= MAX_SHIFT;
    if (bad) failed++;
    console.log(
      `${bad ? "BELOW    " : "ok       "} ${page.padEnd(16)} ${String(score).padStart(3)}  first paint ${Math.round(a["first-contentful-paint"]!.numericValue)} ms, largest ${Math.round(a["largest-contentful-paint"]!.numericValue)} ms, blocking ${Math.round(a["total-blocking-time"]!.numericValue)} ms, shift ${shift.toFixed(3)}`,
    );
  }
} finally {
  server.kill();
}
if (failed) {
  console.error(`${failed} page(s) below the floor of ${FLOOR} or shifting`);
  process.exit(1);
}
