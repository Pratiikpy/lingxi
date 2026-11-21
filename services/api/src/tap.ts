/**
 * Signed answers as TAP-13 defines them, and the delegation of TAP-11 §4 that names their signer (plan H7).
 *
 *   canonicalJSON   TAP-11 §6: RFC 8785 with its five restrictions (no repeated or prototype member names, no
 *                   non-finite or negative-zero numbers, no integers past 2^53 - 1, no unpaired surrogates)
 *   strictParse     TAP-13 §2: JSON text that repeats a member name or names `__proto__`, `constructor` or
 *                   `prototype` is refused while parsing, without choosing a surviving value
 *   responseDigest  TAP-13 §5: keccak256 of the 139-byte preimage
 *   signEnvelope    EIP-191 over that digest, low s, v 27 or 28
 *   verifyEnvelope  TAP-13 §8 steps 4 to 7, recomputed from what the client sent, never from what the answer echoes
 *
 * The canonical form and the parser follow TapeAPI's reference `sdk/src/canon.js` (1.8.1), so both sides agree byte
 * for byte, and the tests run every vector of TAP-11 and TAP-13 through them.
 */

import { type Address, type Hex, concat, getAddress, hashTypedData, keccak256, recoverAddress, stringToBytes, toBytes, toHex } from "viem";
import type { LocalAccount } from "viem/accounts";

export class CanonError extends Error {}

/** Never allowed in signable or parsed JSON: a plain assignment walks the prototype chain, so they vanish. */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The first member name repeated inside one object of the JSON text, or null. `JSON.parse` keeps the last of a
 * repeated pair silently, and two parsers may disagree about which survived; RFC 8785 forbids repeats outright.
 * The text must already be valid JSON. Names are compared after their escapes are decoded.
 */
export function findDuplicateKey(text: string): string | null {
  const n = text.length;
  let i = 0;
  // a Set per open object, null per open array
  const stack: Array<Set<string> | null> = [];
  let expectKey = false;
  const readString = (): string => {
    let out = "";
    i++;
    while (i < n) {
      const c = text[i]!;
      if (c === "\\") {
        const e = text[i + 1]!;
        if (e === "u") {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          out += ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[e] ?? e;
          i += 2;
        }
        continue;
      }
      if (c === '"') {
        i++;
        return out;
      }
      out += c;
      i++;
    }
    return out;
  };
  const inObject = () => stack.length > 0 && stack[stack.length - 1] !== null;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      const key = readString();
      if (expectKey && inObject()) {
        const seen = stack[stack.length - 1]!;
        if (seen.has(key)) return key;
        seen.add(key);
        expectKey = false;
      }
      continue;
    }
    if (c === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (c === "[") {
      stack.push(null);
      expectKey = false;
    } else if (c === "}" || c === "]") {
      stack.pop();
      expectKey = false;
    } else if (c === ",") expectKey = inObject();
    i++;
  }
  return null;
}

/** Parses untrusted JSON text, refusing a forbidden or repeated member name (TAP-13 §2). Throws CanonError. */
export function strictParse(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (k, v: unknown) => {
      if (FORBIDDEN_KEYS.has(k)) throw new CanonError(`forbidden member name "${k}"`);
      return v;
    });
  } catch (e) {
    if (e instanceof CanonError) throw e;
    throw new CanonError("invalid JSON");
  }
  const dup = findDuplicateKey(text);
  if (dup !== null) throw new CanonError(`repeated member name "${dup}"`);
  return parsed;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const wellFormed = (s: string): boolean => !LONE_SURROGATE.test(s);

/**
 * The canonical JSON of a value (TAP-11 §6), written in one pass: a JavaScript object keeps integer-like keys in
 * numeric order ahead of the rest, so building an object and stringifying it would order `"10"` before `"2"` wrongly.
 * Leaves go through `JSON.stringify`, whose string escapes and shortest round-trip numbers are what RFC 8785 says.
 */
export function canonicalJSON(value: unknown, path = "$"): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      if (!wellFormed(value)) throw new CanonError(`unpaired surrogate at ${path}`);
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new CanonError(`non-finite number at ${path}`);
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new CanonError(`integer past 2^53 - 1 at ${path}`);
      if (Object.is(value, -0)) throw new CanonError(`negative zero at ${path}`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonError(`${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    // by index: map() skips the holes of a sparse array, which then read as undefined and are refused
    for (let i = 0; i < value.length; i++) items.push(canonicalJSON(value[i], `${path}[${i}]`));
    return `[${items.join(",")}]`;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") throw new CanonError(`value with toJSON() at ${path}`);
  // the default sort compares UTF-16 code units, as RFC 8785 §3.2.3 requires
  const parts: string[] = [];
  for (const k of Object.keys(value).sort()) {
    if (FORBIDDEN_KEYS.has(k)) throw new CanonError(`forbidden member name "${k}" at ${path}`);
    if (!wellFormed(k)) throw new CanonError(`unpaired surrogate in a member name at ${path}`);
    const item = (value as Record<string, unknown>)[k];
    if (item === undefined) throw new CanonError(`undefined at ${path}.${k}`);
    parts.push(`${JSON.stringify(k)}:${canonicalJSON(item, `${path}.${k}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/** True when the value has a canonical form. */
export function canonical(value: unknown): boolean {
  try {
    canonicalJSON(value);
    return true;
  } catch {
    return false;
  }
}

/** The fixed historical prefix of TAP-13 §5 ("1" and "v2" are not TAP numbers). */
export const RESPONSE_PREFIX = "TAPI-1/resp/v2";
const hashText = (s: string): Hex => keccak256(stringToBytes(s));

export interface Statement {
  container: Address;
  id: string;
  /** the request object: { method, params } */
  request: { method: string; params: Record<string, unknown> };
  ok: boolean;
  /** `result` when ok, `error` when not */
  body: unknown;
  ts: number;
}

/** The 139-byte preimage of TAP-13 §5 and its keccak256. */
export function responseDigest(s: Statement): { preimage: Hex; digest: Hex } {
  const ts = BigInt(s.ts);
  if (ts < 0n || ts > 2n ** 53n - 1n) throw new CanonError("ts out of range");
  const preimage = concat([
    toHex(stringToBytes(RESPONSE_PREFIX)),
    getAddress(s.container),
    hashText(s.id),
    hashText(canonicalJSON({ method: s.request.method, params: s.request.params })),
    s.ok ? "0x01" : "0x00",
    hashText(canonicalJSON(s.body)),
    toHex(ts, { size: 8 }),
  ]).toLowerCase() as Hex;
  return { preimage, digest: keccak256(preimage) };
}

/** keccak256(0x19 ‖ "Ethereum Signed Message:\n32" ‖ digest): EIP-191 personal_sign over 32 bytes. */
export const personalDigest = (digest: Hex): Hex => keccak256(concat([toHex(stringToBytes("\x19Ethereum Signed Message:\n32")), digest]));

/** Signs a statement as TAP-13 §5 says: EIP-191 over the digest, low s, v 27 or 28. */
export async function signStatement(account: LocalAccount, s: Statement): Promise<Hex> {
  return account.signMessage({ message: { raw: responseDigest(s).digest } });
}

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * The 65-byte signature normalised to v 27 or 28, or null when TAP-13 §5 refuses it: not 65 bytes, v outside
 * {0, 1, 27, 28}, r outside [1, n-1], or s outside [1, n/2] (a high-s twin recovers the same address and is still
 * refused, so each digest has one valid encoding per key).
 */
export function normaliseSignature(sig: string): Hex | null {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return null;
  const bytes = toBytes(sig as Hex);
  const r = BigInt(toHex(bytes.slice(0, 32)));
  const s = BigInt(toHex(bytes.slice(32, 64)));
  let v = bytes[64]!;
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) return null;
  if (r < 1n || r >= N || s < 1n || s > N / 2n) return null;
  return concat([toHex(bytes.slice(0, 64)), toHex(v, { size: 1 })]);
}

/** The address a signature over a statement recovers to, or null when the signature is refused or does not recover. */
export async function recoverStatement(s: Statement, sig: string): Promise<Address | null> {
  const norm = normaliseSignature(sig);
  if (!norm) return null;
  try {
    return await recoverAddress({ hash: personalDigest(responseDigest(s).digest), signature: norm });
  } catch {
    return null;
  }
}

/** The address a 32-byte digest's signature recovers to under the same rules (used for the delegation). */
export async function recoverDigest(digest: Hex, sig: string): Promise<Address | null> {
  const norm = normaliseSignature(sig);
  if (!norm) return null;
  try {
    return await recoverAddress({ hash: digest, signature: norm });
  } catch {
    return null;
  }
}

/** The DeWEB hub: TAP-11's delegation domain names it on every chain. */
export const DELEGATION_HUB: Address = "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee";
/** A delegation may run at most 366 days ahead (TAP-11 §4.3). */
export const MAX_DELEGATION_S = 31_622_400;

/** The EIP-712 digest a holder signs to name a signer (TAP-11 §4.1). */
export function delegationDigest(chainId: number, container: Address, signer: Address, expires: number): Hex {
  return hashTypedData({
    domain: { name: "TapeAPI", version: "1", chainId, verifyingContract: DELEGATION_HUB },
    types: { Delegation: [{ name: "container", type: "address" }, { name: "signer", type: "address" }, { name: "expires", type: "uint64" }] },
    primaryType: "Delegation",
    message: { container, signer, expires: BigInt(expires) },
  });
}

export type Outcome =
  | { kind: "accepted"; ok: boolean; body: unknown }
  | { kind: "ownMalformed" }
  | { kind: "binding"; why: string }
  | { kind: "transport" }
  | { kind: "rateLimited" };

const MAX_ENVELOPE = 1_048_576;

/**
 * A client's check of an answer (TAP-13 §8), from the container and signer it resolved and the id, method and params
 * it sent. Never trusts a value the answer echoes.
 */
export async function verifyEnvelope(
  answer: { status: number; text: string },
  sent: { container: Address; signer: Address; id: string; method: string; params: Record<string, unknown> },
  opts: { now?: number; maxSkew?: number } = {},
): Promise<Outcome> {
  if (answer.status === 429) return { kind: "rateLimited" };
  if (new TextEncoder().encode(answer.text).length > MAX_ENVELOPE) return { kind: "transport" };
  let env: Record<string, unknown>;
  try {
    const v = strictParse(answer.text);
    if (typeof v !== "object" || v === null || Array.isArray(v) || typeof (v as { sig?: unknown }).sig !== "string") return { kind: "transport" };
    env = v as Record<string, unknown>;
  } catch {
    return { kind: "transport" };
  }
  const sig = env.sig as string;
  const same = (a: Address | null, b: Address) => !!a && a.toLowerCase() === b.toLowerCase();
  // step 3: a signed refusal of the client's own malformed request
  const err = env.error as { code?: unknown } | undefined;
  if (env.ok === false && err && err.code === "BAD_REQUEST" && Number.isSafeInteger(env.ts)) {
    for (const id of ["", sent.id]) {
      const st = { container: sent.container, id, request: { method: sent.method, params: {} }, ok: false, body: env.error, ts: env.ts as number };
      if (canonical(env.error) && same(await recoverStatement(st, sig), sent.signer)) return { kind: "ownMalformed" };
    }
  }
  // step 4: the answer is bound to this request and this container
  if (env.id !== sent.id) return { kind: "binding", why: "another id" };
  if (typeof env.ok !== "boolean") return { kind: "binding", why: "ok is not a boolean" };
  const body = env.ok ? env.result : env.error;
  if (body === undefined || (env.ok ? "error" in env : "result" in env)) return { kind: "binding", why: "result or error missing" };
  if (typeof env.container !== "string" || env.container.toLowerCase() !== sent.container.toLowerCase()) return { kind: "binding", why: "another container" };
  if (!Number.isSafeInteger(env.ts) || (env.ts as number) < 0) return { kind: "binding", why: "ts is not an integer in range" };
  // step 5: fresh
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - (env.ts as number)) > (opts.maxSkew ?? 300)) return { kind: "binding", why: "ts outside the window" };
  // step 6: recomputed from what was sent
  if (!canonical(body)) return { kind: "binding", why: "body has no canonical form" };
  const st: Statement = { container: sent.container, id: sent.id, request: { method: sent.method, params: sent.params }, ok: env.ok, body, ts: env.ts as number };
  if (!same(await recoverStatement(st, sig), sent.signer)) return { kind: "binding", why: "signature does not recover to the signer" };
  return { kind: "accepted", ok: env.ok, body };
}
