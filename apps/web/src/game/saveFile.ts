/**
 * The save file (P1 S5): the whole game in one file the player keeps, locked with a passphrase they choose. It carries
 * the keys that hold pets on X Layer, so it is handled like a wallet's key: nothing in it can be read without the
 * passphrase, and nobody can recover a lost passphrase, us included.
 *
 * The file is JSON: { kind, v, zip, kdf, cipher, data }. PBKDF2 with SHA-256 over 600,000 rounds (OWASP's 2023 figure
 * for this hash) turns the passphrase and a random 16-byte salt into an AES-256-GCM key; the nonce is a random 12 bytes;
 * the header (every field but `data`) is the cipher's associated data, so a changed header (fewer rounds, say) makes
 * the file refuse to open instead of weakening it. The game's text is gzipped before it is locked where the browser
 * can (`zip` says which), since a save is mostly JSON.
 */

import { readRoster, keptName } from "./roster";
import type { KeyValueStore } from "./save";

export const SAVE_FILE_KIND = "lingxi-save";
export const SAVE_FILE_VERSION = 1;
export const KDF_ROUNDS = 600_000;
/** Rounds a file may ask for: fewer is not a file we made; more would hang the page before saying anything. */
const MIN_ROUNDS = 100_000;
const MAX_ROUNDS = 5_000_000;
/** The shortest passphrase accepted, after spaces around it are dropped (a made one is 23). */
export const MIN_PASSPHRASE = 10;
/** More text than a browser's storage holds is not a save. */
const MAX_SAVE_CHARS = 5_500_000;
/** Kept out of a save file: a tab's stamps, a move's backup and note, and the copies the save module keeps. */
const LEFT_OUT = new Set(["lingxi.writer.lease", "lingxi.handheld.lease", "lingxi.before-move.v1", "lingxi.moved.v1"]);
const GAME_KEY = /^lingxi\.[A-Za-z0-9_.-]+$/;
const isSaved = (key: string) => GAME_KEY.test(key) && !LEFT_OUT.has(key);

export interface SaveContents {
  savedAt: number;
  keys: Record<string, string>;
}

export type OpenResult =
  | { ok: true; contents: SaveContents }
  | { ok: false; reason: "notASave" | "newer" | "locked" | "damaged" };

interface Header {
  kind: typeof SAVE_FILE_KIND;
  v: number;
  zip: "gzip" | "none";
  kdf: { name: "PBKDF2"; hash: "SHA-256"; rounds: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
}

/** The header as associated data: rebuilt field by field in one order, so it reads the same however it was stored. */
const headerBytes = (h: Header) =>
  new TextEncoder().encode(
    JSON.stringify([h.kind, h.v, h.zip, h.kdf.name, h.kdf.hash, h.kdf.rounds, h.kdf.salt, h.cipher.name, h.cipher.iv]),
  );

/** Bytes in memory of their own (what WebCrypto takes). */
type Bytes = Uint8Array<ArrayBuffer>;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(text: string): Bytes | null {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The passphrase as the key is made from it: full-width and other look-alike forms folded, spaces around it dropped. */
const normalise = (p: string) => p.normalize("NFKC").trim();

/** Why a passphrase will not do, or null when it will. */
export const passphraseProblem = (p: string): "short" | null =>
  [...normalise(p)].length < MIN_PASSPHRASE ? "short" : null;

/** 32 letters and digits that cannot be mistaken for each other (no 0/o, 1/l). */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
/** A passphrase made for the player: four groups of five, 100 bits. */
export function makePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

async function keyFrom(passphrase: string, salt: Bytes, rounds: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalise(passphrase)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const canZip = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
async function through(bytes: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Locks the game's contents with a passphrase, returning the file's text. */
export async function sealSave(
  contents: SaveContents,
  passphrase: string,
  o: { rounds?: number } = {},
): Promise<string> {
  if (passphraseProblem(passphrase)) throw new Error("passphrase too short");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const zip = canZip() ? "gzip" : "none";
  const header: Header = {
    kind: SAVE_FILE_KIND,
    v: SAVE_FILE_VERSION,
    zip,
    kdf: { name: "PBKDF2", hash: "SHA-256", rounds: o.rounds ?? KDF_ROUNDS, salt: toB64(salt) },
    cipher: { name: "AES-GCM", iv: toB64(iv) },
  };
  const plain = new TextEncoder().encode(JSON.stringify(contents));
  const body = zip === "gzip" ? await through(plain, new CompressionStream("gzip")) : plain;
  const key = await keyFrom(passphrase, salt, header.kdf.rounds);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: headerBytes(header) }, key, body),
  );
  return JSON.stringify({ ...header, data: toB64(sealed) });
}

/** Reads a header that is ours and sane, or null. */
function readHeader(text: string): (Header & { data: string }) | "newer" | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const f = j as Partial<Header & { data: unknown }>;
  if (!f || typeof f !== "object" || f.kind !== SAVE_FILE_KIND || typeof f.v !== "number") return null;
  if (f.v > SAVE_FILE_VERSION) return "newer";
  const { kdf, cipher, zip, data } = f;
  if (f.v !== SAVE_FILE_VERSION || (zip !== "gzip" && zip !== "none") || typeof data !== "string") return null;
  if (
    !kdf ||
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    typeof kdf.salt !== "string" ||
    !Number.isInteger(kdf.rounds) ||
    kdf.rounds < MIN_ROUNDS ||
    kdf.rounds > MAX_ROUNDS
  )
    return null;
  if (!cipher || cipher.name !== "AES-GCM" || typeof cipher.iv !== "string") return null;
  return {
    kind: SAVE_FILE_KIND,
    v: f.v,
    zip,
    kdf: { name: "PBKDF2", hash: "SHA-256", rounds: kdf.rounds, salt: kdf.salt },
    cipher: { name: "AES-GCM", iv: cipher.iv },
    data,
  };
}

/** Contents that are the game's and nothing else: every key one of the game's, every value text, within a storage's size. */
function validContents(v: unknown): v is SaveContents {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<SaveContents>;
  if (typeof c.savedAt !== "number" || !c.keys || typeof c.keys !== "object" || Array.isArray(c.keys)) return false;
  let chars = 0;
  for (const [k, val] of Object.entries(c.keys)) {
    if (!isSaved(k) || k.endsWith("~copy") || k.endsWith("~damaged") || typeof val !== "string") return false;
    chars += k.length + val.length;
  }
  return chars <= MAX_SAVE_CHARS;
}

/** Opens a save file with its passphrase. Nothing is written anywhere: the caller shows the summary and asks first. */
export async function openSave(text: string, passphrase: string): Promise<OpenResult> {
  const h = readHeader(text);
  if (h === "newer") return { ok: false, reason: "newer" };
  if (!h) return { ok: false, reason: "notASave" };
  const salt = fromB64(h.kdf.salt);
  const iv = fromB64(h.cipher.iv);
  const sealed = fromB64(h.data);
  if (!salt || !iv || !sealed || salt.length < 16 || iv.length !== 12) return { ok: false, reason: "notASave" };
  let body: Bytes;
  try {
    const key = await keyFrom(passphrase, salt, h.kdf.rounds);
    body = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: headerBytes(h) }, key, sealed),
    );
  } catch {
    return { ok: false, reason: "locked" };
  }
  try {
    if (h.zip === "gzip" && !canZip()) return { ok: false, reason: "damaged" };
    const plain = h.zip === "gzip" ? await through(body, new DecompressionStream("gzip")) : body;
    const contents: unknown = JSON.parse(new TextDecoder().decode(plain));
    return validContents(contents) ? { ok: true, contents } : { ok: false, reason: "damaged" };
  } catch {
    return { ok: false, reason: "damaged" };
  }
}

/** The whole game from storage, keys included (see LEFT_OUT for what is not). */
export function saveKeysOf(storage: KeyValueStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !isSaved(k) || k.endsWith("~copy") || k.endsWith("~damaged")) continue;
    const v = storage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

/** What a file holds, for the player to read before it replaces anything. */
export function summarise(c: SaveContents): { pets: string[]; savedAt: number; hasKeys: boolean } {
  let pets: string[] = [];
  try {
    const r = readRoster(c.keys["lingxi.pets.v2"] ?? null, c.keys["lingxi.pet.v1"] ?? null);
    pets = [...r.roster.pets.map((p) => p.name), ...r.kept.map(keptName)];
  } catch {
    pets = [];
  }
  return { pets, savedAt: c.savedAt, hasKeys: "lingxi.session.v1" in c.keys || "lingxi.device.v1" in c.keys };
}
