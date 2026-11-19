/** A4: a deploy never strands a player. Pages are always asked for again, and an open page's files stay served. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { releaseSource, writePointer } from "../src/releases";
import { withSite } from "../src/server";

const A = "20261118T120000Z-aaaaaaa";
const B = "20261118T130000Z-bbbbbbb";

/** Release B live, with release A, the one before it, still kept beside it (A10's releases folder). */
function deployed() {
  const site = mkdtempSync(join(tmpdir(), "deploy-"));
  const write = (release: string, path: string, text: string) => {
    const file = join(site, "releases", release, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  };
  write(B, "play.html", `<!doctype html><script type="module" src="./assets/play-B.js"></script>`);
  write(B, "index.html", `<!doctype html><title>Lingxi</title>`);
  write(B, "assets/play-B.js", "export const build = 'B';");
  write(A, "index.html", `<!doctype html><title>Lingxi A</title>`);
  write(A, "assets/Sheet-A.js", "export const build = 'A';");
  writePointer(site, { release: B, previous: A });
  return withSite(new Hono(), releaseSource(site));
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
    // pages come only from the live release
    expect(await (await app.request("/index.html")).text()).not.toContain("Lingxi A");
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
