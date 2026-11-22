/**
 * Lingxi's MCP server at /mcp (plan H7, TAP-15): the Streamable HTTP transport of MCP revision 2025-11-25, stateless.
 * Every request is one JSON-RPC message parsed with TAP-13's strict parser and answered as application/json; a
 * notification or a response gets 202 with no body; there is no server-to-client stream, so GET and DELETE are 405.
 *
 * The tools (mcpToolDefs.ts) are public and change nothing, so no session or sign-in is needed. Their definitions are
 * pinned by digest in the service manifest, which is why the server lists them exactly as defined and nothing else
 * (no instructions, no resources or prompts beyond empty lists). The server core follows TapeAPI's `createMcpServer`
 * (`sdk/src/mcp.js`, 1.8.1).
 */

import type { Context, Hono } from "hono";
import { strictParse } from "./tap";
import { RateLimiter } from "./limit";
import { clientIp } from "./clientIp";
import { readCapped } from "./tapApi";
import { MCP_TOOLS } from "./mcpToolDefs";
import { ToolArgsError, type ToolDeps, callTool } from "./mcpTools";

/** Newest first; the server answers with the client's version when it knows it, else its newest (MCP lifecycle). */
export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
/** The version a request without an MCP-Protocol-Version header is taken to speak (MCP 2025-11-25, transports). */
const DEFAULT_VERSION = "2025-03-26";
const MAX_BODY = 64 * 1024;
const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 } as const;
export const MCP_SERVER_INFO = { name: "lingxi", title: "Lingxi", version: "1.0.0" };

type Id = string | number | null;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });

/** One JSON-RPC message in, one out (null for a notification or a response, which get nothing back). */
export async function handleMcp(msg: unknown, deps: ToolDeps): Promise<object | null> {
  if (!isObj(msg) || msg.jsonrpc !== "2.0") return rpcError(isObj(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null, RPC.INVALID_REQUEST, "not a JSON-RPC 2.0 message");
  // a response from the client (to a request we never send) or a notification: nothing to answer
  if (typeof msg.method !== "string") return "result" in msg || "error" in msg ? null : rpcError(null, RPC.INVALID_REQUEST, "no method");
  if (msg.id === undefined) return null;
  const id = msg.id;
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, RPC.INVALID_REQUEST, "id must be a string or a number");
  const params = msg.params === undefined ? {} : msg.params;
  if (!isObj(params)) return rpcError(id, RPC.INVALID_PARAMS, "params must be an object");
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_VERSIONS[0];
        return rpcResult(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: MCP_TOOLS });
      case "tools/call": {
        if (typeof params.name !== "string") return rpcError(id, RPC.INVALID_PARAMS, "params.name must be the tool name");
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!isObj(args)) return rpcError(id, RPC.INVALID_PARAMS, "params.arguments must be an object");
        try {
          return rpcResult(id, await callTool(params.name, args, deps));
        } catch (e) {
          if (e instanceof ToolArgsError) return rpcError(id, RPC.INVALID_PARAMS, e.message);
          return rpcError(id, RPC.INTERNAL, "internal error");
        }
      }
      // capabilities not declared, answered politely so that generic clients do not fail
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      default:
        return rpcError(id, RPC.METHOD_NOT_FOUND, `method ${msg.method.slice(0, 64)} is not supported`);
    }
  } catch {
    return rpcError(id, RPC.INTERNAL, "internal error");
  }
}

export interface McpDeps extends ToolDeps {
  limiter?: RateLimiter;
}

export function withMcp(app: Hono, deps: McpDeps): Hono {
  // a proposal reads all 65,536 situations twice (about half a second), so the door is narrower than the REST API's
  const limiter = deps.limiter ?? new RateLimiter(120, 3_600_000);
  const json = (c: Context, body: unknown, status = 200, extra: Record<string, string> = {}) => c.body(JSON.stringify(body), status as 200, { "content-type": "application/json", ...extra });

  app.post("/mcp", async (c) => {
    if (!limiter.take(clientIp(c))) return json(c, rpcError(null, RPC.INTERNAL, "too many requests; try again later"), 429);
    const version = c.req.header("mcp-protocol-version") ?? DEFAULT_VERSION;
    if (!(MCP_VERSIONS as readonly string[]).includes(version)) return json(c, rpcError(null, RPC.INVALID_REQUEST, `unsupported MCP-Protocol-Version ${version.slice(0, 32)}`), 400);
    // read with a cap: the rest of a longer body is never read
    const text = await readCapped(c, MAX_BODY).catch(() => null);
    if (text === null) return json(c, rpcError(null, RPC.INVALID_REQUEST, `body over ${MAX_BODY} bytes`), 413, { connection: "close" });
    let msg: unknown;
    try {
      msg = strictParse(text);
    } catch {
      return json(c, rpcError(null, RPC.PARSE, "parse error"), 400);
    }
    // JSON-RPC batches are not part of MCP since 2025-06-18
    if (Array.isArray(msg)) return json(c, rpcError(null, RPC.INVALID_REQUEST, "batches are not supported"), 400);
    const out = await handleMcp(msg, deps);
    if (out === null) return c.body(null, 202);
    return json(c, out);
  });
  // no server-to-client stream and no sessions
  for (const verb of ["GET", "DELETE"] as const) app.on(verb, "/mcp", (c) => c.body(null, 405, { allow: "POST" }));
  return app;
}
