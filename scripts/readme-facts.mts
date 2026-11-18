/**
 * The README's numbers, counted from the repo so they cannot go stale.
 *
 * Each number in README.md sits between markers, `<!--f:name-->123<!--/f-->` (invisible when rendered). This script
 * counts every fact and rewrites the markers with `--write`, or with `--check` exits non-zero and lists each number
 * that no longer matches. Test counts come from running the suites themselves, so a number of passing tests is only
 * ever written when they pass.
 *
 *   pnpm exec tsx scripts/readme-facts.mts --check | --write [--no-tests]
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "../packages/chain/src/rules.ts";
import { SKILLS, TREES } from "../packages/game/src/skills.ts";
import { CHARACTERS, DAILIES, ITEM, LANE, RECIPES, ROOMS, STORY } from "../packages/world/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(root, "README.md");
const write = process.argv.includes("--write");
const withTests = !process.argv.includes("--no-tests");

/** Test packages, in the order the README lists them. */
const PACKAGES = ["game", "world", "api", "api-schema", "brain", "handheld", "chain", "send", "web", "art"] as const;

function vitestPassed(pkg: string): number {
  const dir = mkdtempSync(join(tmpdir(), "lingxi-facts-"));
  const out = join(dir, "r.json");
  try {
    const p = spawnSync(`pnpm --filter @lingxi/${pkg} exec vitest run --reporter=json "--outputFile=${out}"`, { cwd: root, encoding: "utf8", shell: true, maxBuffer: 256 * 1024 * 1024 });
    const r = JSON.parse(readFileSync(out, "utf8")) as { numPassedTests: number; numFailedTests: number };
    if (p.status !== 0 || r.numFailedTests > 0) throw new Error(`@lingxi/${pkg}: ${r.numFailedTests} tests fail; no count is written for a failing suite`);
    return r.numPassedTests;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function forgePassed(args: string[]): number {
  const p = spawnSync(`forge test --json ${args.map((a) => `"${a}"`).join(" ")}`, { cwd: join(root, "contracts"), encoding: "utf8", shell: true, maxBuffer: 256 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`forge test ${args.join(" ")} failed:\n${p.stderr.slice(-2000)}`);
  const suites = JSON.parse(p.stdout.slice(p.stdout.indexOf("{"))) as Record<string, { test_results: Record<string, { status: string }> }>;
  return Object.values(suites).flatMap((s) => Object.values(s.test_results)).filter((t) => t.status === "Success").length;
}

const deployment = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<string, unknown>;
/** The eleven contracts the README's table lists, by their deployment keys. */
const CONTRACT_KEYS = ["registry", "breeder", "adoptionCentre", "outfitMarketV2", "itemShop", "extras", "holderGift", "look", "redPacket", "outfitMarket", "breederFree"];

const facts: Record<string, string> = {
  rooms: String(Object.keys(ROOMS).length),
  quests: String(STORY.length),
  dailies: String(DAILIES.length),
  items: String(Object.keys(ITEM).length),
  recipes: String(RECIPES.length),
  skills: String(SKILLS.length),
  trees: String(TREES.length),
  rules: String(RULES.length),
  residents: String(CHARACTERS.length),
  builders: String(LANE.length),
  contracts: String(CONTRACT_KEYS.filter((k) => typeof deployment[k] === "string").length),
};

if (withTests) {
  let total = 0;
  for (const pkg of PACKAGES) {
    const n = vitestPassed(pkg);
    facts[`tests-${pkg}`] = String(n);
    total += n;
  }
  facts["tests"] = String(total);
  facts["forge-unit"] = String(forgePassed([]));
  facts["forge-fork"] = String(forgePassed(["--fork-url", "xlayer", "--match-path", "test/*.fork.t.sol"]));
  facts["tests-all"] = String(total + Number(facts["forge-unit"]) + Number(facts["forge-fork"]));
}

const text = readFileSync(README, "utf8");
const stale: string[] = [];
const seen = new Set<string>();
const next = text.replace(/<!--f:([a-z0-9-]+)-->(.*?)<!--\/f-->/g, (whole, name: string, was: string) => {
  seen.add(name);
  const now = facts[name];
  if (now === undefined) {
    if (!withTests && (name.startsWith("tests") || name.startsWith("forge"))) return whole;
    stale.push(`${name}: no such fact`);
    return whole;
  }
  if (now !== was) stale.push(`${name}: README says ${was}, the repo says ${now}`);
  return `<!--f:${name}-->${now}<!--/f-->`;
});
const unused = Object.keys(facts).filter((k) => !seen.has(k));

if (write) {
  writeFileSync(README, next);
  console.log(`README facts written: ${Object.entries(facts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
} else if (stale.length) {
  console.log(`README facts out of date:\n  ${stale.join("\n  ")}`);
  process.exit(1);
} else {
  console.log(`README facts match the repo (${seen.size} checked)${unused.length ? `; not quoted in the README: ${unused.join(", ")}` : ""}`);
}
