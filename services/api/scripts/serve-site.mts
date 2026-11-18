/**
 * Serves a built site with the server's own site handling (withSite: page headers, kept files) and nothing else, for
 * rehearsing a deploy locally: `tsx scripts/serve-site.mts <dist> [port]`.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { relative, resolve } from "node:path";
import { withSite } from "../src/server";

const [dist, port = "5245"] = process.argv.slice(2);
if (!dist) throw new Error("usage: serve-site.mts <dist> [port]");
const root = relative(process.cwd(), resolve(dist));
serve({ fetch: withSite(new Hono(), root, relative(process.cwd(), resolve(dist, "..", "assets-kept"))).fetch, port: Number(port), hostname: "127.0.0.1" });
console.log(`site ${root} on 127.0.0.1:${port}`);
