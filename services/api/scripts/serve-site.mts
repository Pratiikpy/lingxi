/**
 * Serves a built site with the server's own site handling (withSite: page headers, earlier releases' files) and nothing
 * else, for rehearsing a release locally: `tsx scripts/serve-site.mts <site> [port]`. A folder holding `releases/` is
 * served as the live site serves its releases (A10); any other folder is served as it is.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { releaseSource } from "../src/releases";
import { withSite } from "../src/server";

const [dir, port = "5245"] = process.argv.slice(2);
if (!dir) throw new Error("usage: serve-site.mts <site> [port]");
const site = resolve(dir);
const releases = existsSync(join(site, "releases"));
serve({
  fetch: withSite(new Hono(), releases ? releaseSource(site) : relative(process.cwd(), site)).fetch,
  port: Number(port),
  hostname: "127.0.0.1",
});
console.log(`${releases ? "releases" : "site"} ${site} on 127.0.0.1:${port}`);
