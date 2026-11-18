import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playerIdFor } from "@lingxi/chain";
import { cleanPlaced, createDecorStore } from "../src/decor";

const KEY = "a".repeat(32);
const OTHER = "b".repeat(32);
const MINE = playerIdFor(KEY);

describe("shared home decorations", () => {
  it("a home belongs to the key its id comes from; nobody else can claim it, even first", () => {
    const s = createDecorStore();
    // a squatter who saw the id tries first, with its own key
    expect(s.authorise(MINE, OTHER)).toBe(false);
    expect(s.set(MINE, OTHER, [])).toBe(false);
    expect(s.set(MINE, KEY, [{ id: "fern", x: 20, y: 90 }])).toEqual([{ id: "fern", x: 20, y: 90 }]);
    expect(s.set(MINE, OTHER, [])).toBe(false);
    expect(s.get(MINE)).toEqual([{ id: "fern", x: 20, y: 90 }]);
    expect(s.set(MINE, KEY, [])).toEqual([]);
    // an id that is not derived from any key it is shown with cannot be claimed at all
    expect(s.authorise("owner123", KEY)).toBe(false);
  });

  it("a home bound before ids came from keys keeps working with its own key, and only that", () => {
    const file = join(mkdtempSync(join(tmpdir(), "decor-")), "home-decor.json");
    const hash = createHash("sha256").update(`lingxi-decor:${KEY}`).digest("hex");
    writeFileSync(file, JSON.stringify({ owner123: { key: hash, placed: [] } }));
    const s = createDecorStore(file);
    expect(s.authorise("owner123", KEY)).toBe(true);
    expect(s.authorise("owner123", OTHER)).toBe(false);
  });

  it("rejects unknown pieces, duplicates, too many, bad keys and bad owners; clamps positions", () => {
    expect(cleanPlaced([{ id: "throne", x: 1, y: 1 }])).toBeNull();
    expect(cleanPlaced([{ id: "fern", x: 1, y: 1 }, { id: "fern", x: 2, y: 2 }])).toBeNull();
    expect(cleanPlaced(Array.from({ length: 13 }, () => ({ id: "fern", x: 1, y: 1 })))).toBeNull();
    expect(cleanPlaced([{ id: "fern", x: -900, y: 9999 }])).toEqual([{ id: "fern", x: 6, y: 124 }]);
    const s = createDecorStore();
    expect(s.set("owner123", "short", [])).toBe(false);
    expect(s.set("NO SPACES", KEY, [])).toBe(false);
  });

  it("keeps homes across a restart without keeping the key in clear", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "decor-")), "home-decor.json");
    createDecorStore(file).set(MINE, KEY, [{ id: "rug", x: 64, y: 110 }]);
    await new Promise((r) => setTimeout(r, 2300));
    const again = createDecorStore(file);
    expect(again.get(MINE)).toEqual([{ id: "rug", x: 64, y: 110 }]);
    expect(again.set(MINE, OTHER, [])).toBe(false);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(file, "utf8")).not.toContain(KEY);
  });
});
