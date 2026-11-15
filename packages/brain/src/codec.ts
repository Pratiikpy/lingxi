/**
 * Share a brain as a link. "lx1." + base64url of a compact JSON form of the
 * program (labels included, so a shared brain keeps its explanations). The
 * decoder always runs the full validator, so a crafted link can never produce
 * a program the compiler would not accept.
 */

import { type Program, ProgramError, validateProgram } from "./program";

const PREFIX = "lx1.";
export const MAX_CODE_LENGTH = 12_000;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ProgramError("link is not valid base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeProgram(p: Program): string {
  return PREFIX + b64urlEncode(JSON.stringify(p));
}

export function decodeProgram(code: string): Program {
  if (typeof code !== "string" || !code.startsWith(PREFIX)) throw new ProgramError("not a Lingxi brain link");
  if (code.length > MAX_CODE_LENGTH) throw new ProgramError("brain link is too long");
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(code.slice(PREFIX.length)));
  } catch (e) {
    if (e instanceof ProgramError) throw e;
    throw new ProgramError("brain link is damaged");
  }
  return validateProgram(parsed);
}
