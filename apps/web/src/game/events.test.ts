/**
 * A22: every one-off event the game sends is on the world's EVENTS list, and every listed event is sent from somewhere.
 * A quest or badge can only ask for a listed event, so one sent but unlisted counts for nothing, and one listed but never
 * sent is a goal no player can reach. Read from the game's own source, so a new noteEvent cannot slip past.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVENTS } from "@lingxi/world";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every way the game sends one: noteEvent("x"), noteTally("EVENT", "x", n) and the world store's tally("EVENT", "x", n). */
const SENDS = /noteEvent\("([^"]+)"\)|(?:noteTally|tally)\("EVENT", "([^"]+)"/g;
const sent = new Set(
  sourceFiles(SRC).flatMap((f) => [...readFileSync(f, "utf8").matchAll(SENDS)].map((m) => (m[1] ?? m[2])!)),
);

describe("the game's one-off events (A22)", () => {
  it("are all on the world's list", () => {
    expect([...sent].filter((e) => !(EVENTS as readonly string[]).includes(e))).toEqual([]);
  });

  it("and every listed event is sent from somewhere", () => {
    expect(EVENTS.filter((e) => !sent.has(e))).toEqual([]);
  });
});
