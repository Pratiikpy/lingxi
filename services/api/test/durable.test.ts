/**
 * A139: a store's file survives a crash. A write is flushed to disk before it replaces the file, the file it replaces is
 * kept as `.bak`, and a file that cannot be read is moved aside (never written over) while the `.bak` is read instead.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadJson, saveJson } from "../src/durable";

const tmp = () => mkdtempSync(join(tmpdir(), "lx-durable-"));

describe("a store's file survives a crash (A139)", () => {
  it("writes the file, and keeps the one it replaced as .bak", () => {
    const file = join(tmp(), "store.json");
    saveJson(file, { n: 1 });
    saveJson(file, { n: 2 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ n: 2 });
    expect(JSON.parse(readFileSync(`${file}.bak`, "utf8"))).toEqual({ n: 1 });
    expect(readdirSync(join(file, "..")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("reads the file; with none, it says so", () => {
    const file = join(tmp(), "store.json");
    expect(loadJson(file)).toEqual({ state: "none" });
    saveJson(file, [1, 2, 3]);
    expect(loadJson(file)).toEqual({ state: "ok", value: [1, 2, 3], from: "file" });
  });

  it("a file cut short is moved aside, never written over, and the .bak is read in its place", () => {
    const file = join(tmp(), "store.json");
    saveJson(file, { lessons: 64 });
    saveJson(file, { lessons: 65 });
    writeFileSync(file, '{"lessons": 6');
    const got = loadJson(file);
    expect(got).toEqual({ state: "ok", value: { lessons: 64 }, from: "bak" });
    expect(existsSync(file), "the damaged file is no longer where the next save would write over it").toBe(false);
    const aside = readdirSync(join(file, "..")).filter((n) => n.startsWith("store.json.damaged-"));
    expect(aside.length).toBe(1);
    expect(readFileSync(join(file, "..", aside[0]!), "utf8"), "kept exactly as it was").toBe('{"lessons": 6');
  });

  it("a file and .bak both unreadable say so, with both kept aside, so the store can refuse to start empty over them", () => {
    const file = join(tmp(), "store.json");
    writeFileSync(file, "{");
    writeFileSync(`${file}.bak`, "[");
    expect(loadJson(file)).toEqual({ state: "damaged" });
    expect(readdirSync(join(file, "..")).filter((n) => n.includes(".damaged-")).length).toBe(2);
  });

  it("a crash between keeping the .bak and the new file leaves the .bak to read", () => {
    const file = join(tmp(), "store.json");
    saveJson(file, { day: 1 });
    // as if the process died after the old file became .bak and before the new one took its place
    writeFileSync(`${file}.bak`, readFileSync(file));
    rmSync(file);
    expect(loadJson(file)).toEqual({ state: "ok", value: { day: 1 }, from: "bak" });
  });
});
