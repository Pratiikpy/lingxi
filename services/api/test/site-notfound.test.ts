/** P6: an address the site does not have is answered with the site's own not-found page and status 404. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withSite } from "../src/server";

function site(withPage = true) {
  const root = mkdtempSync(join(tmpdir(), "site-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>home</title>");
  if (withPage) writeFileSync(join(root, "404.html"), "<!doctype html><title>Not here · Lingxi</title><h1>This page isn't here</h1>");
  return withSite(new Hono(), relative(process.cwd(), root));
}

describe("an address the site does not have (P6)", () => {
  it("is answered with the site's not-found page, status 404, as a page", async () => {
    const r = await site().request("/no/such/page");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("This page isn't here");
  });

  it("leaves pages that exist alone", async () => {
    const r = await site().request("/");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>home</title>");
  });

  it("keeps a plain 404 for the API and for a site without the page", async () => {
    const api = await site().request("/api/no-such-call");
    expect(api.status).toBe(404);
    expect(await api.text()).not.toContain("This page isn't here");
    const bare = await site(false).request("/no/such/page");
    expect(bare.status).toBe(404);
  });
});
