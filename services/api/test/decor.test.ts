import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanPlaced, createDecorStore } from "../src/decor";

const KEY = "a".repeat(32);
const OTHER = "b".repeat(32);

describe("shared home decorations", () => {
  it("binds a home to the first key and refuses anyone else", () => {
    const s = createDecorStore();
    expect(s.set("owner123", KEY, [{ id: "fern", x: 20, y: 90 }])).toEqual([{ id: "fern", x: 20, y: 90 }]);
    expect(s.set("owner123", OTHER, [])).toBe(false);
    expect(s.get("owner123")).toEqual([{ id: "fern", x: 20, y: 90 }]);
    expect(s.set("owner123", KEY, [])).toEqual([]);
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
    createDecorStore(file).set("owner123", KEY, [{ id: "rug", x: 64, y: 110 }]);
    await new Promise((r) => setTimeout(r, 2300));
    const again = createDecorStore(file);
    expect(again.get("owner123")).toEqual([{ id: "rug", x: 64, y: 110 }]);
    expect(again.set("owner123", OTHER, [])).toBe(false);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(file, "utf8")).not.toContain(KEY);
  });
});
