/**
 * A store kept as one JSON file per key, in a folder beside the file it used to be (A123): `<file>.d/<key>.json`.
 * Writing a key rewrites only that key's file, through a temporary file and a rename, so a crash mid-write never leaves
 * a half file; a temporary file such a crash left behind is cleared on open. A store still kept as the one old file is
 * moved in on first open, and the old file is put aside under `<file><aside>`, never deleted.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
      writeFileSync(`${path(key)}.tmp`, JSON.stringify(value));
      renameSync(`${path(key)}.tmp`, path(key));
    } catch (e) {
      process.stderr.write(`${what} ${key} not saved: ${(e as Error).message}\n`);
    }
  };
  for (const name of readdirSync(dir)) if (name.endsWith(".tmp")) rmSync(join(dir, name), { force: true });
  if (existsSync(file)) {
    try {
      const old = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(old)) if (KEY.test(key) && !existsSync(path(key))) write(key, value);
    } catch {
      // a damaged old file moves nothing in; it is still put aside below, as it was
    }
    renameSync(file, `${file}${aside}`);
  }
  return {
    all() {
      const out = new Map<string, unknown>();
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const key = name.slice(0, -".json".length);
        if (!KEY.test(key)) continue;
        try {
          out.set(key, JSON.parse(readFileSync(join(dir, name), "utf8")));
        } catch {
          // a damaged file is skipped rather than stopping the server
        }
      }
      return out;
    },
    write,
    remove(key) {
      rmSync(path(key), { force: true });
    },
  };
}
