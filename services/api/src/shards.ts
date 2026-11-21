/**
 * A store kept as one JSON file per key, in a folder beside the file it used to be (A123): `<file>.d/<key>.json`.
 * Writing a key rewrites only that key's file, through a temporary file and a rename, so a crash mid-write never leaves
 * a half file; a temporary file such a crash left behind is cleared on open. A store still kept as the one old file is
 * moved in on first open, and the old file is put aside under `<file><aside>`, never deleted.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadJson, readStore, saveJson } from "./durable";

const KEY = /^[A-Za-z0-9-]{1,32}$/;

export interface Shards {
  /** every key's value, as kept; a damaged file is skipped */
  all(): Map<string, unknown>;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

export function openShards(file: string, aside: string, what: string): Shards {
  const dir = `${file}.d`;
  mkdirSync(dir, { recursive: true });
  const path = (key: string) => {
    if (!KEY.test(key)) throw new Error(`not a ${what} key: ${key}`);
    return join(dir, `${key}.json`);
  };
  const write = (key: string, value: unknown) => {
    try {
      saveJson(path(key), undefined, JSON.stringify(value));
    } catch (e) {
      process.stderr.write(`${what} ${key} not saved: ${(e as Error).message}\n`);
    }
  };
  for (const name of readdirSync(dir)) if (name.endsWith(".tmp")) rmSync(join(dir, name), { force: true });
  if (existsSync(file)) {
    try {
      const old = readStore(file) as Record<string, unknown>;
      for (const [key, value] of Object.entries(old)) if (KEY.test(key) && !existsSync(path(key))) write(key, value);
    } catch {
      // a damaged old file moves nothing in; it is still put aside below, as it was
    }
    // a damaged old file was already put aside where it lay (A139); one read is put aside here
    if (existsSync(file)) renameSync(file, `${file}${aside}`);
  }
  return {
    all() {
      // every key with a file or a .bak; a key file that cannot be read is kept aside and its .bak read (A139)
      const keys = new Set<string>();
      for (const name of readdirSync(dir)) {
        const m = /^([A-Za-z0-9-]{1,32})\.json(?:\.bak)?$/.exec(name);
        if (m) keys.add(m[1]!);
      }
      const out = new Map<string, unknown>();
      for (const key of keys) {
        const r = loadJson(path(key));
        if (r.state === "ok") out.set(key, r.value);
        else if (r.state === "damaged") process.stderr.write(`${what} ${key}: its file and .bak could not be read; both kept aside\n`);
      }
      return out;
    },
    write,
    remove(key) {
      rmSync(path(key), { force: true });
      rmSync(`${path(key)}.bak`, { force: true });
    },
  };
}
