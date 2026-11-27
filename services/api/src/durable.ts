/**
 * A store's file, written and read so that a crash cannot lose it (A139).
 *
 * A write goes to a temporary file that is flushed to disk before it takes the file's place, and the file it replaces
 * is kept as `<file>.bak`, so a crash at any moment leaves either the new file or the one before it. A file that cannot
 * be read (cut short by a power cut, say) is moved aside as `<file>.damaged-<time>`, never written over, and the `.bak`
 * is read in its place; when neither can be read the caller is told, so a store can refuse to start empty over them.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { noteWriteFailure } from "./storage";

export type Loaded = { state: "ok"; value: unknown; from: "file" | "bak" } | { state: "none" } | { state: "damaged" };

/** Writes `text` to `path`, flushed to disk before this returns: for a file the caller then renames into place. */
export function writeFlushed(path: string, text: string): void {
  try {
    const fd = openSync(path, "w");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    // R45: a failed write is noted, so the health report says the server cannot save, and still thrown to its caller
    noteWriteFailure(path, e);
    throw e;
  }
}

/** Writes `value` (or text already made) to `file`, flushed to disk, keeping the file it replaces as `.bak`. */
export function saveJson(file: string, value: unknown, text = JSON.stringify(value)): void {
  const tmp = `${file}.tmp`;
  writeFlushed(tmp, text);
  if (existsSync(file)) renameSync(file, `${file}.bak`);
  renameSync(tmp, file);
}

const aside = (path: string) => {
  if (existsSync(path))
    renameSync(path, `${path.replace(/\.bak$/, "")}.damaged-${Date.now()}${path.endsWith(".bak") ? "-bak" : ""}`);
};

const parse = (path: string): { ok: true; value: unknown } | { ok: false } | null => {
  if (!existsSync(path)) return null;
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false };
  }
};

/** Reads `file`, or its `.bak` when the file is missing or cannot be read; a file that cannot be read is moved aside. */
export function loadJson(file: string): Loaded {
  const main = parse(file);
  if (main?.ok) return { state: "ok", value: main.value, from: "file" };
  if (main && !main.ok) aside(file);
  const bak = parse(`${file}.bak`);
  if (bak?.ok) return { state: "ok", value: bak.value, from: "bak" };
  if (bak && !bak.ok) aside(`${file}.bak`);
  return main || bak ? { state: "damaged" } : { state: "none" };
}

/** Whether a store has anything to read: its file, or the `.bak` a crash between the two renames left alone. */
export function hasStore(file: string): boolean {
  return existsSync(file) || existsSync(`${file}.bak`);
}

/**
 * A store's saved value, for a store that starts empty when it has none: from the file, or from its `.bak` when the file
 * cannot be read (said on stderr). When neither can be read both are kept aside, said on stderr, and this throws, so
 * the store starts empty without ever writing over what it could not read.
 */
export function readStore(file: string): unknown {
  const r = loadJson(file);
  if (r.state === "ok") {
    if (r.from === "bak") process.stderr.write(`${file} could not be read: kept aside, read ${file}.bak instead\n`);
    return r.value;
  }
  if (r.state === "damaged")
    process.stderr.write(`${file} and its .bak could not be read: both kept aside, starting empty\n`);
  throw new Error(`no readable ${file}`);
}
