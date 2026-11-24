/**
 * A32: what a duel link carries. A challenge or result code is often thousands of characters, more than a chat message
 * holds, so with the live server the link carries a short token instead: `s.<id>`, the id being the first 16 characters
 * of the code's SHA-256, under which the server keeps the code. A token is resolved only to a code that hashes back to
 * it, so the server cannot swap one challenge for another. Without the server (the on-chain copy) the link carries the
 * code itself, as before.
 */
import { duelLinkId, isDuelCode } from "@lingxi/game";

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof location !== "undefined" && location.hostname === "localhost" ? "http://localhost:8787" : "");
const TOKEN = /^s\.([A-Za-z0-9_-]{16})$/;

/** The short token for a code when the server keeps it, else the code itself. */
export async function linkToken(code: string, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!BASE && fetchFn === fetch) return code;
  try {
    const r = await fetchFn(`${BASE}/api/duels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) return code;
    const { id } = (await r.json()) as { id?: unknown };
    return typeof id === "string" && id === (await duelLinkId(code)) ? `s.${id}` : code;
  } catch {
    return code;
  }
}

/** The code a link's token stands for, checked against its id; an inline code is its own; null when it cannot be had. */
export async function tokenCode(token: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const m = TOKEN.exec(token);
  if (!m) return isDuelCode(token) ? token : null;
  try {
    const r = await fetchFn(`${BASE}/api/duels/${m[1]}`);
    if (!r.ok) return null;
    const { code } = (await r.json()) as { code?: unknown };
    return typeof code === "string" && isDuelCode(code) && (await duelLinkId(code)) === m[1] ? code : null;
  } catch {
    return null;
  }
}
