/**
 * The agent API's answers, signed (plan H7): every /api/v1 operation is also a TAP-13 method at
 * `POST /api/v1/<method>`, and every answer that reaches a method route comes back as an envelope signed by the key
 * the TAP-11 manifest names (`.well-known/tapeapi.json`, delegated by the holder of circuit #1, our DeWEB container).
 *
 * A method runs the GET or POST route of the same operation in this process, so its result is exactly what that route
 * answers, refusals included (an unknown token is a signed result saying so). Only protocol failures are errors:
 * BAD_REQUEST for a malformed request or parameter (TAP-13 §3 and §4's binding rules), METHOD_NOT_FOUND for a name we
 * do not serve, INTERNAL when the operation could not run. Rate limiting is the unsigned 429 of §7. The GET routes
 * are unchanged.
 */

import type { Context, Hono } from "hono";
import type { Address } from "viem";
import type { LocalAccount } from "viem/accounts";
import { CanonError, type Statement, canonical, signStatement, strictParse, wellFormed } from "./tap";
import { RateLimiter } from "./limit";
import { TAP_METHODS } from "./tapMethods";
import { clientIp } from "./clientIp";

/** The largest request body a method reads; the agent API's own routes take the same (bodyLimits.ts). */
export const TAP_BODY_LIMIT = 16 * 1024;
/** The answer cap of TAP-13 §4. */
const MAX_ANSWER = 1_048_576;
/** An operation that takes longer is answered with a signed INTERNAL (TAP-13 §4 asks for 30 s). */
const TIME_BOUND_MS = 25_000;
/** What a rate-limited caller is told to wait, in seconds. */
const RETRY_AFTER_S = 60;
const METHOD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

type Params = Record<string, unknown>;
const BY_NAME = new Map(TAP_METHODS.map((m) => [m.name, m]));

export interface TapApiDeps {
  signer: LocalAccount;
  /** the service container: circuit #1's ERC-6551 account */
  container: Address;
  limiter?: RateLimiter;
  now?: () => number;
}

type ErrorCode = "BAD_REQUEST" | "METHOD_NOT_FOUND" | "INTERNAL";
const STATUS: Record<ErrorCode, number> = { BAD_REQUEST: 400, METHOD_NOT_FOUND: 404, INTERNAL: 500 };

/** Reads at most `max` bytes of the body: null when it is longer (the rest is never read). */
async function readCapped(c: Context, max: number): Promise<string | null> {
  const stream = c.req.raw.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const ch of chunks) {
    all.set(ch, at);
    at += ch.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

const validId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 128 && wellFormed(v);

export { TAP_METHODS } from "./tapMethods";

export function withTapApi(app: Hono, deps: TapApiDeps): Hono {
  const limiter = deps.limiter ?? new RateLimiter(240, 3_600_000);
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const rateLimited = (c: Context) =>
    c.json({ ok: false, error: { code: "RATE_LIMITED", message: "too many requests; try again later", data: { retryAfterS: RETRY_AFTER_S } } }, 429, { "retry-after": String(RETRY_AFTER_S) });

  /** Signs and sends one envelope; an answer over the cap becomes a signed INTERNAL. */
  const answer = async (c: Context, id: string, request: Statement["request"], out: { ok: true; result: unknown } | { ok: false; code: ErrorCode; message: string }, sizeLimited = false): Promise<Response> => {
    const ts = now();
    const body = out.ok ? out.result : { code: out.code, message: out.message };
    const st: Statement = { container: deps.container, id, request, ok: out.ok, body, ts };
    const sig = await signStatement(deps.signer, st);
    const env = out.ok ? { id, ok: true, result: body, container: deps.container, ts, sig } : { id, ok: false, error: body, container: deps.container, ts, sig };
    const text = JSON.stringify(env);
    if (out.ok && new TextEncoder().encode(text).length > MAX_ANSWER) return answer(c, id, request, { ok: false, code: "INTERNAL", message: "answer too large" });
    const status = out.ok ? 200 : sizeLimited ? 413 : STATUS[out.code];
    return c.body(text, status as 200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  };

  app.post("/api/v1/:method", async (c) => {
    const method = c.req.param("method");
    // a path that is not a method name is a route error, deliberately unsigned (TAP-13 §7)
    if (!METHOD_RE.test(method)) return c.json({ ok: false, reason: "unknown" }, 404);
    if (!limiter.take(clientIp(c))) return rateLimited(c);
    const blank = { method, params: {} };
    // binding rule 1: nothing in an unparseable or oversized body can be trusted, so the refusal names id ""
    const text = await readCapped(c, TAP_BODY_LIMIT);
    if (text === null) return answer(c, "", blank, { ok: false, code: "BAD_REQUEST", message: `body over ${TAP_BODY_LIMIT} bytes` }, true);
    let req: unknown;
    try {
      req = strictParse(text);
    } catch (e) {
      return answer(c, "", blank, { ok: false, code: "BAD_REQUEST", message: e instanceof CanonError ? e.message : "invalid JSON" });
    }
    if (typeof req !== "object" || req === null || Array.isArray(req)) return answer(c, "", blank, { ok: false, code: "BAD_REQUEST", message: "the body must be a JSON object" });
    const r = req as Record<string, unknown>;
    if (!validId(r.id)) return answer(c, "", blank, { ok: false, code: "BAD_REQUEST", message: "id must be a string of 1 to 128 UTF-16 code units" });
    const id = r.id;
    // binding rule 2: params that are present but not an object, or have no canonical form
    const params = r.params === undefined ? {} : r.params;
    if (typeof params !== "object" || params === null || Array.isArray(params) || !canonical(params)) return answer(c, id, blank, { ok: false, code: "BAD_REQUEST", message: "params must be a JSON object with a canonical form" });
    const request = { method, params: params as Params };
    if (r.method !== undefined && r.method !== method) return answer(c, id, request, { ok: false, code: "BAD_REQUEST", message: "method differs from the path" });
    const m = BY_NAME.get(method);
    if (!m) return answer(c, id, request, { ok: false, code: "METHOD_NOT_FOUND", message: `no method ${method}; see the manifest at /.well-known/tapeapi.json` });
    const route = m.route(request.params);
    if (typeof route === "string") return answer(c, id, request, { ok: false, code: "BAD_REQUEST", message: route });
    // the same route a REST caller reaches, in this process, as this caller
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const h of ["authorization", "cf-connecting-ip"]) {
      const v = c.req.header(h);
      if (v !== undefined) headers[h] = v;
    }
    let res: Response;
    try {
      const run = app.request(route.path, { method: route.verb, headers, ...(route.body !== undefined ? { body: JSON.stringify(route.body) } : {}) }, c.env);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((ok) => (timer = setTimeout(() => ok("late"), TIME_BOUND_MS)));
      const got = await Promise.race([Promise.resolve(run), late]);
      clearTimeout(timer);
      if (got === "late") return answer(c, id, request, { ok: false, code: "INTERNAL", message: "timed out" });
      res = got;
    } catch {
      return answer(c, id, request, { ok: false, code: "INTERNAL", message: "internal error" });
    }
    let out: unknown;
    try {
      out = await res.json();
    } catch {
      return answer(c, id, request, { ok: false, code: "INTERNAL", message: "internal error" });
    }
    const o = out as { ok?: unknown; reason?: unknown; detail?: unknown };
    // the route's own rate limit refuses before doing any work: unsigned, as §7 says
    if (o.ok === false && o.reason === "busy") return rateLimited(c);
    if (res.status >= 500) return answer(c, id, request, { ok: false, code: "INTERNAL", message: "unavailable" });
    if (res.status === 400 || res.status === 413) return answer(c, id, request, { ok: false, code: "BAD_REQUEST", message: typeof o.detail === "string" ? o.detail : typeof o.reason === "string" ? o.reason : "invalid" });
    if (!canonical(out)) return answer(c, id, request, { ok: false, code: "INTERNAL", message: "internal error" });
    return answer(c, id, request, { ok: true, result: out });
  });
  return app;
}
