/** The built site's security headers: HTTPS pinned, and scripts only from where the pages really load them. */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { scriptPolicy, withSite } from "../src/server";

const INLINE = "\n  console.info('telegram check');\n";
function site() {
  const root = mkdtempSync(join(tmpdir(), "site-"));
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><script type="module" src="./assets/a.js"></script><title>x</title>`,
  );
  writeFileSync(
    join(root, "play.html"),
    `<!doctype html><script>${INLINE}</script><script type="module" src="./assets/b.js"></script>`,
  );
  return withSite(new Hono(), relative(process.cwd(), root));
}

describe("site headers", () => {
  it("pins HTTPS and allows scripts only from our origin, Telegram, Cloudflare's beacon and each page's own inline scripts by hash", async () => {
    const app = site();
    const home = await app.request("/");
    expect(home.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    const csp = home.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      "script-src 'self' 'wasm-unsafe-eval' https://telegram.org https://static.cloudflareinsights.com",
    );
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("unsafe-inline");
    const play = (await app.request("/play.html")).headers.get("content-security-policy") ?? "";
    const hash = createHash("sha256").update(INLINE).digest("base64");
    expect(play).toContain(`'sha256-${hash}'`);
    // the game alone may sit inside Telegram Web's frame
    expect(play).toContain("frame-ancestors 'self' https://web.telegram.org https://*.web.telegram.org");
    expect(scriptPolicy("<script>a</script><script src=x></script><script type=module>b</script>").hashes).toHaveLength(
      2,
    );
    // a file written with Windows line ends is hashed as the browser sees it, with LF
    expect(scriptPolicy("<script>a\r\nb</script>").hashes).toEqual(scriptPolicy("<script>a\nb</script>").hashes);
  });
});
