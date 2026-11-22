/**
 * TAP-15's checks on an MCP tool list (plan H7): the digest a manifest pins as `mcp.toolsSha256` and the hidden-text
 * rule. Both follow TapeAPI's reference `sdk/src/mcp.js` (`normalizeTools`, `toolsDigest`, `invisibleProblems`, 1.8.1)
 * and are tested on every vector TAP-15 publishes.
 */

import { createHash } from "node:crypto";
import { canonicalJSON } from "./tap";

/** The members of a tool that tell a model what it does and how to call it (TAP-15 §3.2); the rest is not hashed. */
export const COVERED = ["name", "title", "description", "inputSchema", "outputSchema", "annotations"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** TAP-15 §3.2: the covered members only, sorted by name in UTF-16 code-unit order; null when the list has no digest. */
export function normaliseTools(tools: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(tools)) return null;
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const t of tools) {
    if (!isObj(t) || typeof t.name !== "string" || !t.name || seen.has(t.name)) return null;
    seen.add(t.name);
    out.push(Object.fromEntries(COVERED.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])));
  }
  return out.sort((a, b) => ((a.name as string) < (b.name as string) ? -1 : (a.name as string) > (b.name as string) ? 1 : 0));
}

/** TAP-15 §3.3: hex SHA-256 of the canonical JSON of the normalised list, or null when the list has none. */
export function toolsDigest(tools: unknown): string | null {
  const norm = normaliseTools(tools);
  if (!norm) return null;
  try {
    return createHash("sha256").update(canonicalJSON(norm), "utf8").digest("hex");
  } catch {
    return null;
  }
}

/** The braille blank and the musical null notehead: blank, and not Default_Ignorable */
const BLANK = new Set([0x2800, 0x1d159]);
const variationSelector = (p: number) => (p >= 0xfe00 && p <= 0xfe0f) || (p >= 0xe0100 && p <= 0xe01ef);

/** TAP-15 §3.4: is this code point hidden, given whether it sits in a description and the code point before it. */
function hidden(c: string, inDescription: boolean, prev: string | null): boolean {
  const p = c.codePointAt(0)!;
  // only VS15 or VS16 directly after an emoji passes; every other variation selector can spell hidden text
  if (variationSelector(p)) return !((p === 0xfe0e || p === 0xfe0f) && prev !== null && /\p{Emoji}/u.test(prev));
  if (/\p{Cf}/u.test(c) || /\p{Default_Ignorable_Code_Point}/u.test(c) || BLANK.has(p)) return true;
  return /\p{Cc}/u.test(c) && !(inDescription && (c === "\n" || c === "\t"));
}

function firstHidden(s: string, inDescription: boolean): string | null {
  let prev: string | null = null;
  for (const c of s) {
    if (hidden(c, inDescription, prev)) return c;
    prev = c;
  }
  return null;
}

const u = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Every string and member name of a tool list's covered members that carries a hidden code point (TAP-15 §3.4), one
 * line each ([] when none). A line feed or tab is allowed only in the value of a member named `description`.
 */
export function hiddenText(tools: unknown): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(tools) ? tools : []) {
    if (!isObj(t)) continue;
    const who = `tool ${JSON.stringify(String(t.name))}`;
    const walk = (v: unknown, path: string, key: string) => {
      if (typeof v === "string") {
        const c = firstHidden(v, key === "description");
        if (c) out.push(`${who}: ${path}: ${u(c)}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
      else if (isObj(v))
        for (const k of Object.keys(v)) {
          const c = firstHidden(k, false);
          if (c) out.push(`${who}: ${path} key: ${u(c)}`);
          walk(v[k], `${path}.${k}`, k);
        }
    };
    for (const f of COVERED) if (t[f] !== undefined) walk(t[f], f, f);
  }
  return out;
}
