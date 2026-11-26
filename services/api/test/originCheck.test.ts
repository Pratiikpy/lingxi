/**
 * R13: a write is taken only from the game's own pages. A page on another site can post to this server from a
 * visitor's browser without asking first (a "simple" request: text/plain, no-cors), and the write routes took it: the
 * visitor's address then spent that visitor's limits and filled our stores with what the other site chose. A browser
 * names the page a cross-site write comes from (the Origin header), so a write from a page that is not ours is refused.
 * A request with no Origin (a program, the agent's own client, the status check) is not a browser's cross-site write
 * and is left to each route's own checks; the agent API stays open to any page, as it is meant to be.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withOriginCheck } from "../src/originCheck";

const OURS = "https://lingxi.example";

function app() {
  const a = new Hono();
  withOriginCheck(a, [OURS, "http://localhost:5199"]);
  a.post("/api/errors", (c) => c.json({ ok: true }));
  a.post("/api/v1/pets", (c) => c.json({ ok: true }));
  a.get("/api/pets/1/log", (c) => c.json({ ok: true }));
  return a;
}
const post = (path: string, headers: Record<string, string>) =>
  app().request(`http://server.internal${path}`, { method: "POST", headers, body: "{}" });

describe("writes are taken only from the game's own pages (R13)", () => {
  it("a write from another site's page is refused, whatever its content type", async () => {
    for (const type of ["text/plain", "application/json"]) {
      const r = await post("/api/errors", { origin: "https://evil.example", "content-type": type });
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ ok: false, reason: "origin" });
    }
    // a page with no origin of its own (a sandboxed frame, a file) says "null"
    expect((await post("/api/errors", { origin: "null" })).status).toBe(403);
  });

  it("a write from the game's pages is taken: a listed origin, or the server's own host", async () => {
    expect((await post("/api/errors", { origin: OURS })).status).toBe(200);
    expect((await post("/api/errors", { origin: "http://localhost:5199" })).status).toBe(200);
    // the same origin as the request itself, whatever the list says (a new domain in front of the same server)
    expect(
      (await post("/api/errors", { origin: "https://play.other.example", host: "play.other.example" })).status,
    ).toBe(200);
    // the same host on another scheme or port is another origin
    expect(
      (await post("/api/errors", { origin: "http://play.other.example:8080", host: "play.other.example" })).status,
    ).toBe(403);
  });

  it("a request with no Origin is not a browser's cross-site write, and passes to the route", async () => {
    expect((await post("/api/errors", {})).status).toBe(200);
  });

  it("the agent API takes writes from any page, and reads are not this check's business", async () => {
    expect((await post("/api/v1/pets", { origin: "https://evil.example" })).status).toBe(200);
    const read = await app().request("http://server.internal/api/pets/1/log", {
      headers: { origin: "https://evil.example" },
    });
    expect(read.status).toBe(200);
  });
});
