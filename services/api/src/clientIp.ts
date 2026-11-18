/**
 * Who is asking. The server listens on 127.0.0.1 only, so every outside request comes through the Cloudflare tunnel,
 * which sets `cf-connecting-ip` to the address it saw and overwrites any value a caller sent. That is the only
 * header trusted: `x-forwarded-for` and `x-real-ip` are written by the caller and would let one client pass every
 * limit by rotating them. Without Cloudflare (development) the socket's own address is used.
 */

import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";

export function clientIp(c: Context): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf !== undefined) return cf.length <= 45 && isIP(cf.trim()) ? cf.trim() : "invalid";
  try {
    return getConnInfo(c).remote.address ?? "local";
  } catch {
    // an in-process request (tests) has no socket
    return "local";
  }
}
