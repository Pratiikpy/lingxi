/**
 * Who is asking. The server listens on 127.0.0.1 only, so every outside request comes through the Cloudflare tunnel,
 * which sets `cf-connecting-ip` to the address it saw and overwrites any value a caller sent. That is the only
 * header trusted: `x-forwarded-for` and `x-real-ip` are written by the caller and would let one client pass every
 * limit by rotating them. Without Cloudflare (development) the socket's own address is used.
 *
 * An IPv6 caller is its /64 network (A54): a household is usually given a whole /64, and counting each of its 2^64
 * addresses as a new caller would let one rotate past every per-address limit. Every limit keys on this function, so
 * this is the one place that decides it.
 */

import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";

export function clientIp(c: Context): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf !== undefined) return cf.length <= 45 && isIP(cf.trim()) ? callerOf(cf.trim()) : "invalid";
  try {
    const remote = getConnInfo(c).remote.address;
    return remote && isIP(remote) ? callerOf(remote) : "local";
  } catch {
    // an in-process request (tests) has no socket
    return "local";
  }
}

/** The eight 16-bit groups of an IPv6 address, an embedded IPv4 tail read as its two groups. */
function groupsOf(v6: string): number[] {
  let text = v6.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, null];
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const fill = tail === null ? [] : Array<string>(8 - front.length - back.length).fill("0");
  return [...front, ...fill, ...back].map((g) => parseInt(g || "0", 16));
}

/** An IPv4 address as it is; an IPv6 address as its /64 network, or as the IPv4 address it maps. */
export function callerOf(address: string): string {
  if (isIP(address) !== 6) return address;
  const g = groupsOf(address);
  // ::ffff:a.b.c.d is an IPv4 caller
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join(".");
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}
