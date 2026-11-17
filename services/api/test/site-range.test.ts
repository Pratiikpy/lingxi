/** The built site's files: ranges a browser or a scanner sends, valid or not, never make the server fail. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withSite } from "../src/server";

function site() {
  const root = mkdtempSync(join(tmpdir(), "site-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(join(root, "data.txt"), "0123456789");
  // the static server reads a root relative to where it runs, as the live server's LINGXI_STATIC is
  return withSite(new Hono(), relative(process.cwd(), root));
}
const get = (app: Hono, range?: string) => app.request("/data.txt", range ? { headers: { range } } : {});

describe("file ranges", () => {
  it("answers a valid range with the part asked for", async () => {
    const r = await get(site(), "bytes=2-4");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("234");
  });

  it("ignores a range in words or another unit and sends the whole file", async () => {
    for (const range of ["bytes=abc-def", "items=0-1", "bytes=", "nonsense"]) {
      const r = await get(site(), range);
      expect(r.status, range).toBe(200);
      expect(await r.text()).toBe("0123456789");
    }
  });

  it("refuses a range that starts past the end with 416, not a failure", async () => {
    const r = await get(site(), "bytes=99999999-");
    expect(r.status).toBe(416);
  });

  it("serves the file whole with no range", async () => {
    const r = await get(site());
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("0123456789");
  });
});
