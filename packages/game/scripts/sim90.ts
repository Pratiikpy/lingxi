/**
 * The 90-day simulator (plan row G0): five simulated players through the game's real rules for 90 days, the spar
 * field, and a watch of every school lesson, deterministic from a seed. No network, no chain, no model.
 *
 *   npx tsx scripts/sim90.ts                  the readable report
 *   npx tsx scripts/sim90.ts --json [file]    every number, as JSON (to stdout, or to the file)
 *   npx tsx scripts/sim90.ts --check          quiet; exits 1 only if a target recorded as met is not met now
 *   npx tsx scripts/sim90.ts --write          records each target's measured value and verdict in
 *                                             src/balanceMeasured.generated.ts
 *   --seed <n>  --days <n>                    another seed or length (--check and --write keep the recorded ones)
 */

import { budgetChoiceKey, writeBudgetChoiceCache } from "./sim90/budgetChoice";
import { BUDGET_CHOICE_CACHE } from "./sim90/budgetChoice.generated";
import { writeFileSync } from "node:fs";
import { BALANCE_MEASURED, evaluateTargets, staleTargets } from "../src";
import { report } from "./sim90/report";
import { DEFAULT_DAYS, DEFAULT_SEED, runSim } from "./sim90/run";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const number = (name: string, fallback: number) => {
  const v = value(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} needs a whole number above 0, not "${v}"`);
  return n;
};

if (flag("--check") || flag("--write")) {
  // D13: the exhaustive gate-budget measure is cached; --write brings the cache current first
  if (flag("--write") && BUDGET_CHOICE_CACHE.key !== budgetChoiceKey()) writeBudgetChoiceCache();
  const n = runSim({ seed: DEFAULT_SEED, days: DEFAULT_DAYS });
  const now = evaluateTargets(n);
  if (flag("--write")) {
    const targets = Object.fromEntries(now.map((t) => [t.id, { value: t.value, status: t.met ? "met" : "open" }]));
    writeFileSync(
      new URL("../src/balanceMeasured.generated.ts", import.meta.url),
      `/* Written by scripts/sim90.ts --write; re-run it to reproduce. Do not edit by hand. */\n\nexport interface BalanceMeasured {\n  seed: number;\n  days: number;\n  targets: Record<string, { value: string; status: "met" | "open" }>;\n}\n\nexport const BALANCE_MEASURED: BalanceMeasured = ${JSON.stringify({ seed: n.seed, days: n.days, targets }, null, 2)};\n`,
    );
    process.stdout.write(now.map((t) => `${t.met ? "met " : "open"} ${t.id}: ${t.value}`).join("\n") + "\n");
  } else {
    const regressed = now.filter((t) => BALANCE_MEASURED.targets[t.id]?.status === "met" && !t.met);
    const unrecorded = now.filter((t) => !BALANCE_MEASURED.targets[t.id]);
    for (const t of now.filter((x) => !x.met && !regressed.includes(x))) process.stdout.write(`open ${t.id}: ${t.value}\n`);
    for (const t of now.filter((x) => x.met && BALANCE_MEASURED.targets[x.id]?.status === "open")) process.stdout.write(`now met, not yet recorded (run --write): ${t.id}\n`);
    for (const t of unrecorded) process.stdout.write(`not recorded (run --write): ${t.id}\n`);
    for (const t of regressed) process.stderr.write(`REGRESSED ${t.id}: recorded met, now ${t.value}\n`);
    // D21: a recorded value that no longer matches what the simulator measures is stale, whatever its status, so the
    // record cannot quietly drift from the game (it had, from D9 to D12, while every status still held)
    const staleIds = staleTargets(now, BALANCE_MEASURED.targets);
    const stale = now.filter((t) => staleIds.includes(t.id));
    for (const t of stale) process.stderr.write(`STALE ${t.id}: recorded "${BALANCE_MEASURED.targets[t.id]!.value}", now "${t.value}" (run --write)\n`);
    process.exitCode = regressed.length || unrecorded.length || stale.length ? 1 : 0;
  }
} else {
  const n = runSim({ seed: number("--seed", DEFAULT_SEED), days: number("--days", DEFAULT_DAYS) });
  if (flag("--json")) {
    const file = value("--json");
    const text = JSON.stringify(n, null, 2);
    if (file && !file.startsWith("--")) writeFileSync(file, text + "\n");
    else process.stdout.write(text + "\n");
  } else process.stdout.write(report(n) + "\n");
}
