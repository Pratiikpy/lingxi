/**
 * `pnpm perf:budget [site]`: every page of a built site against its budget (scripts/perf-budget.json), in KB of what it
 * loads before it runs, gzip-compressed (page-weights.mts). Fails when a page is past its budget, or a page of 10 KB or
 * more has no budget, so a page can neither grow nor appear unweighed (P3). What the service worker keeps for the game
 * offline is held to its own budget, so the download a first visit makes behind the game cannot grow unseen (R61).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { offlineWeight, pageWeights } from "./page-weights.mts";

/** Pages lighter than this carry no scripts worth a budget. */
const UNWEIGHED_BELOW = 10 * 1024;

const site = process.argv[2] ?? join("apps", "web", "dist");
const { pages, offline } = JSON.parse(readFileSync(join(import.meta.dirname, "perf-budget.json"), "utf8")) as {
  pages: Record<string, number>;
  offline: number;
};
let failed = 0;
for (const w of pageWeights(site)) {
  const kb = w.total / 1024;
  const budget = pages[w.page];
  if (budget === undefined) {
    if (w.total < UNWEIGHED_BELOW) continue;
    console.log(`NO BUDGET  ${w.page}: ${kb.toFixed(1)} KB; give it one in scripts/perf-budget.json`);
    failed++;
    continue;
  }
  const over = kb > budget;
  if (over) failed++;
  console.log(
    `${over ? "OVER     " : "ok       "} ${w.page.padEnd(16)} ${kb.toFixed(1).padStart(7)} KB of ${budget} KB`,
  );
}
const kept = offlineWeight(site);
const keptKb = kept.total / 1024;
if (keptKb > offline) failed++;
console.log(
  `${keptKb > offline ? "OVER     " : "ok       "} ${"offline (sw.js)".padEnd(16)} ${keptKb.toFixed(1).padStart(7)} KB of ${offline} KB: ${kept.files} files, ${kept.stored} bytes as kept`,
);
if (failed) {
  console.error(`${failed} page(s) over budget or unweighed`);
  process.exit(1);
}
