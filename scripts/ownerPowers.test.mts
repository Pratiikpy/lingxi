/**
 * Every power the contracts give their owner is listed in the README (A89). The owner-gated functions are read from
 * the contracts' sources (each `onlyOwner` function, and any that check `owner()` themselves), and each must be named
 * in the README's table of owner powers, in the row of its own contract; a new power that is not written down fails.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const src = join(root, "contracts", "src");

/** Contract name → the functions only its owner may call. */
function ownerFunctions(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readdirSync(src).filter((f) => f.endsWith(".sol"))) {
    const text = readFileSync(join(src, file), "utf8");
    // the declaration, at the start of a line (comments mention "the contract" too)
    const contract = /^(?:abstract )?contract (\w+)/m.exec(text)?.[1];
    if (!contract) continue;
    const names = new Set<string>();
    for (const m of text.matchAll(/function (\w+)\([^)]*\)[^{;]*\bonlyOwner\b/g)) names.add(m[1]!);
    // a function that checks the owner itself, through a helper that compares msg.sender with owner()
    if (/msg\.sender != owner\(\)/.test(text)) for (const m of text.matchAll(/function (\w+)\([^)]*\)[^{]*\{\s*_creatorsDesign\(/g)) names.add(m[1]!);
    if (names.size) found.set(contract, [...names].sort());
  }
  return found;
}

/** The README's table of owner powers: contract → its row's text. */
function readmeRows(): Map<string, string> {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const start = readme.indexOf("| Contract | What its owner can do |");
  expect(start, "the README has its table of owner powers").toBeGreaterThan(-1);
  const rows = new Map<string, string>();
  for (const line of readme.slice(start).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((c) => c.trim());
    rows.set(cells[1]!.replace(/[`*]/g, ""), line);
  }
  return rows;
}

describe("every owner power is in the README (A89)", () => {
  it("names each owner-gated function of each contract in that contract's row", () => {
    const powers = ownerFunctions();
    expect(powers.size, "the contracts were read").toBeGreaterThan(5);
    const rows = readmeRows();
    for (const [contract, fns] of powers) {
      const row = rows.get(contract);
      expect(row, `${contract} has a row in the README's owner table`).toBeDefined();
      for (const fn of fns) expect(row, `${contract}.${fn} is named in its row`).toContain(`\`${fn}\``);
    }
  });

  it("says which contracts give their owner nothing", () => {
    const rows = readmeRows();
    for (const contract of ["HolderGift", "Breeder"]) expect(rows.get(contract), `${contract}'s row`).toMatch(/nothing/i);
  });
});
