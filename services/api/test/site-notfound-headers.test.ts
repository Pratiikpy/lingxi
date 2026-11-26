/**
 * R16: the not-found page is a page like any other. A HEAD for an address the site does not have was answered as
 * plain text while a GET got the page, so a link checker or a preview saw a different answer from a visitor's; and the
 * page went out with no content policy of its own (the policy was looked up by the address asked for, which names no
 * file), though its script and styles are held to one on every other page.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withSite } from "../src/server";

function site() {
  const root = mkdtempSync(join(tmpdir(), "site-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>home</title><script>var a = 1;</script>");
  writeFileSync(
    join(root, "404.html"),
    "<!doctype html><title>Not here · Lingxi</title><h1>This page isn't here</h1><script>var b = 2;</script>",
  );
  return withSite(new Hono(), relative(process.cwd(), root));
}

describe("the not-found page's own answer (R16)", () => {
  it("a HEAD for a missing address is the page's answer without its body, as a GET's is with it", async () => {
    const app = site();
    const get = await app.request("/no/such/page");
    const head = await app.request("/no/such/page", { method: "HEAD" });
    expect(head.status).toBe(404);
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
    expect(head.headers.get("content-type")).toContain("text/html");
    expect(await head.text()).toBe("");
  });

  it("goes out under the same protections as every page: its own content policy, HSTS, no sniffing, no framing", async () => {
    const app = site();
    const home = await app.request("/");
    for (const method of ["GET", "HEAD"]) {
      const r = await app.request("/no/such/page", { method });
      const csp = r.headers.get("content-security-policy");
      expect(csp, `${method}: a content policy`).toBeTruthy();
      // the policy is the not-found page's own: it allows that page's script, not the home page's
      expect(csp).toContain("script-src");
      expect(csp).not.toBe(home.headers.get("content-security-policy"));
      expect(r.headers.get("strict-transport-security"), method).toContain("max-age=");
      expect(r.headers.get("x-content-type-options"), method).toBe("nosniff");
      expect(r.headers.get("x-frame-options"), method).toBe("SAMEORIGIN");
      // a page is asked for again each time, so a new release's not-found page is seen at once
      expect(r.headers.get("cache-control"), method).toBe("no-cache");
    }
  });

  it("the API's own 404 stays a plain answer", async () => {
    const r = await site().request("/api/no-such-call", { method: "HEAD" });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});
