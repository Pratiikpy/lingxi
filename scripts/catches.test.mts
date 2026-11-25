/**
 * P7, check 4: every catch that drops its error says why that is safe, on the line or within the three above it. A
 * promise's `.catch(() => null)` (or undefined, false, nothing) and an empty `catch {}` are where a failure goes
 * unseen; the audit of 2026-11-25 found two that told a player something false about their own pet (a chain that
 * could not be read said as "not yours"), fixed them, and wrote the reason beside the rest. This keeps a new silent
 * catch from coming in without one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const SOURCES = ["apps", "services", "packages", "scripts"];
const SKIP = /node_modules|[\\/]dist|[\\/]coverage|[\\/]public[\\/]|\.test\.|\.spec\.|\.d\.ts$|[\\/]e2e[\\/]\.run/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP.test(full)) continue;
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

/** a promise catch that throws the error away, or an empty catch block */
const SILENT =
  /\.catch\(\s*\(\)\s*=>\s*(null|undefined|\{\s*\}|false|0|\[\]|""|void 0)\s*\)|catch\s*(\(\w*\))?\s*\{\s*\}/;

describe("no catch drops an error without saying why (P7)", () => {
  const all = SOURCES.flatMap((d) => files(join(root, d)));

  it("reads the source", () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it("each silent catch has its reason beside it", () => {
    const missing: string[] = [];
    for (const f of all) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!SILENT.test(line)) return;
        const near = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        if (!/\/\/|\/\*/.test(near))
          missing.push(`${relative(root, f).split("\\").join("/")}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
