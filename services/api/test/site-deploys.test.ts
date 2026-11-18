/** A4: a deploy never strands a player. Pages are always asked for again, and an open page's files stay served. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withSite } from "../src/server";

/** A built site (build B) beside the files kept from the build before it (build A). */
function deployed() {
  const base = mkdtempSync(join(tmpdir(), "deploy-"));
  const root = join(base, "dist");
  const kept = join(base, "assets-kept");
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(kept, "assets"), { recursive: true });
  writeFileSync(join(root, "play.html"), `<!doctype html><script type="module" src="./assets/play-B.js"></script>`);
  writeFileSync(join(root, "index.html"), `<!doctype html><title>Lingxi</title>`);
  writeFileSync(join(root, "assets", "play-B.js"), "export const build = 'B';");
  writeFileSync(join(kept, "assets", "Sheet-A.js"), "export const build = 'A';");
  return withSite(new Hono(), relative(process.cwd(), root), relative(process.cwd(), kept));
}

describe("deploys (A4)", () => {
  it("sends every page with no-cache, so a browser never reuses an old page past a deploy", async () => {
    const app = deployed();
    for (const path of ["/", "/play.html", "/index.html"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("no-cache");
    }
  });

  it("still serves a file of the build before, for a page that was open when the new one went live", async () => {
    const app = deployed();
    const old = await app.request("/assets/Sheet-A.js");
    expect(old.status).toBe(200);
    expect(await old.text()).toContain("'A'");
    expect(old.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const current = await app.request("/assets/play-B.js");
    expect(await current.text()).toContain("'B'");
  });

  it("never marks a missing file to be kept for a year", async () => {
    const res = await deployed().request("/assets/gone-Z.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reads nothing outside the kept folder", async () => {
    const res = await deployed().request("/assets/..%2f..%2fdist%2fplay.html");
    expect(res.status).toBe(404);
  });
});
