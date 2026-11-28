/**
 * P3: what a page loads before it runs, as the speed budget counts it: the scripts it names and every script they import
 * statically, its module preloads, stylesheets and preloaded fonts, each counted once and gzip-compressed; not what loads
 * later (a dynamic import), and not what another host serves.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { offlineWeight, pageWeights } from "./page-weights.mts";

function site(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "weights-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const gz = (s: string) => gzipSync(Buffer.from(s), { level: 6 }).length;

describe("what a page loads before it runs (P3)", () => {
  const files = {
    "index.html": `<html><head><script type="module" crossorigin src="./assets/main.js"></script><link rel="modulepreload" crossorigin href="./assets/pre.js"><link rel="stylesheet" href="./assets/a.css"><link rel="preload" as="font" type="font/woff2" crossorigin href="./assets/f.woff2"><script src="https://telegram.org/x.js"></script></head><body></body></html>`,
    "assets/main.js": `import{a}from"./shared.js";import"./side.js";const later=()=>import("./later.js");export{a};`,
    "assets/shared.js": `export const a=1;`,
    "assets/side.js": `import{a}from"./shared.js";console.log(a);`,
    "assets/later.js": `export const big="${"x".repeat(5000)}";`,
    "assets/pre.js": `export const p=2;`,
    "assets/a.css": `body{color:red}`,
    "assets/f.woff2": "FONTDATA",
    "other.html": `<html><head><script type="module" src="./assets/shared.js"></script></head></html>`,
  };

  it("follows static imports once each, leaves dynamic ones and other hosts out, and counts styles and fonts", () => {
    const dir = site(files);
    const w = pageWeights(dir).find((x) => x.page === "index.html")!;
    expect(w.files.map((f) => f.split(/[\\/]/).slice(-2).join("/"))).toEqual([
      "assets/a.css",
      "assets/f.woff2",
      "assets/main.js",
      "assets/pre.js",
      "assets/shared.js",
      "assets/side.js",
    ]);
    const js = ["assets/main.js", "assets/pre.js", "assets/shared.js", "assets/side.js"].reduce(
      (n, f) => n + gz(files[f as keyof typeof files]),
      0,
    );
    expect(w.scripts).toBe(js);
    expect(w.styles).toBe(gz(files["assets/a.css"]) + Buffer.byteLength(files["assets/f.woff2"]));
    expect(w.html).toBe(gz(files["index.html"]));
    expect(w.total).toBe(w.scripts + w.styles + w.html);
  });

  it("weighs every page of the site on its own", () => {
    const dir = site(files);
    const other = pageWeights(dir).find((x) => x.page === "other.html")!;
    expect(other.files.map((f) => f.split(/[\\/]/).pop())).toEqual(["shared.js"]);
  });
});

describe("what the service worker keeps for the game offline (R61)", () => {
  const list = (files: string[]) =>
    `/*\n * worker\n */\nconst PRECACHE = ${JSON.stringify({ version: "v1", files })};\nconst KEEP = 1;`;

  it("every file of its list once, scripts and styles gzip-compressed, faces and pictures as they are", () => {
    const dir = site({
      "sw.js": list(["play.html", "assets/a.js", "assets/a.css", "assets/f.woff2", "art/room.png", "assets/a.js"]),
      "play.html": "<html>game</html>",
      "assets/a.js": `export const a="${"y".repeat(3000)}";`,
      "assets/a.css": "body{color:red}",
      "assets/f.woff2": "FONTDATA",
      "art/room.png": "PNGDATA!",
    });
    const w = offlineWeight(dir);
    expect(w.files).toBe(5);
    expect(w.total).toBe(
      gz("<html>game</html>") +
        gz(`export const a="${"y".repeat(3000)}";`) +
        gz("body{color:red}") +
        Buffer.byteLength("FONTDATA") +
        Buffer.byteLength("PNGDATA!"),
    );
  });

  it("a listed file the build does not have is an error: the worker would never keep it", () => {
    const dir = site({ "sw.js": list(["play.html", "assets/gone.js"]), "play.html": "<html></html>" });
    expect(() => offlineWeight(dir)).toThrow(/assets\/gone\.js/);
  });

  it("a worker without its list is an error, not an empty weight", () => {
    const dir = site({ "sw.js": "/*__PRECACHE__*/\nconst KEEP = 1;" });
    expect(() => offlineWeight(dir)).toThrow(/list/);
  });
});
