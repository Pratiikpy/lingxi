/**
 * A10: the site's releases. Each release is a complete build in a folder of its own, `<site>/releases/<name>/`, and
 * `<site>/current.json` names the live one. A release goes live when that one small file is replaced, which the file
 * system does in one step (written beside it, then renamed over it), so no request ever finds the site half-written.
 * Releases before the live one stay, and serve the files a page left open asks for later (A4), until the release
 * command removes them (scripts/site-release.mts).
 */

import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A release's name: when it was built (UTC) and the commit it came from; `-dirty` marks a rehearsal of uncommitted work. */
export const RELEASE_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{7,40}(-dirty)?$/;

export interface Pointer {
  /** the live release */
  release: string;
  /** the release before it, which a rollback makes live again */
  previous?: string;
}

export const releasesDir = (site: string): string => join(site, "releases");
export const pointerFile = (site: string): string => join(site, "current.json");

const isRelease = (site: string, name: unknown): name is string => {
  if (typeof name !== "string" || !RELEASE_NAME.test(name)) return false;
  try {
    return statSync(join(releasesDir(site), name)).isDirectory();
  } catch {
    return false;
  }
};

/** The pointer, or null when there is none, it cannot be read, or it names no release in the folder. */
export function readPointer(site: string): Pointer | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(pointerFile(site), "utf8"));
  } catch {
    return null;
  }
  const p = raw as { release?: unknown; previous?: unknown } | null;
  if (!p || !isRelease(site, p.release)) return null;
  return { release: p.release, ...(isRelease(site, p.previous) ? { previous: p.previous } : {}) };
}

/** Makes `p.release` live in one step: the pointer is written beside the old one and renamed over it. */
export function writePointer(site: string, p: Pointer): void {
  for (const name of [p.release, p.previous]) if (name !== undefined && !RELEASE_NAME.test(name)) throw new Error(`not a release name: ${name}`);
  const next = `${pointerFile(site)}.next`;
  writeFileSync(next, `${JSON.stringify(p)}\n`);
  // a reader holding the old file open can make a rename fail for a moment on Windows: try again, briefly
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(next, pointerFile(site));
      return;
    } catch (e) {
      if (attempt >= 20) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/** The releases in the folder, newest first (their names begin with when they were built). */
export function listReleases(site: string): string[] {
  if (!existsSync(releasesDir(site))) return [];
  return readdirSync(releasesDir(site))
    .filter((name) => isRelease(site, name))
    .sort()
    .reverse();
}

/** Where a request's files come from: the live folder, and the folders whose files are still served after it. */
export interface SiteSource {
  /** the live folder, or null when nothing is live */
  root(): string | null;
  /** folders an asset missing from the live one is looked for in, in order */
  fallbacks(): readonly string[];
}

/** One folder, served as it is (tests, and rehearsing a single build). */
export function folderSource(root: string): SiteSource {
  return { root: () => root, fallbacks: () => [] };
}

/**
 * The live release, read from the pointer each time it changes. A pointer that goes missing, cannot be read or names
 * no release leaves the last good one live: a deploy can only ever replace a release with another.
 */
export function releaseSource(site: string): SiteSource {
  let seen = "";
  let live: { root: string; fallbacks: string[] } | null = null;
  const refresh = () => {
    let stamp = "";
    try {
      const s = statSync(pointerFile(site));
      stamp = `${s.mtimeMs}:${s.size}`;
    } catch {
      return;
    }
    if (stamp === seen) return;
    const p = readPointer(site);
    seen = stamp;
    if (!p) return;
    const dir = releasesDir(site);
    live = { root: join(dir, p.release), fallbacks: listReleases(site).filter((name) => name !== p.release).map((name) => join(dir, name)) };
  };
  return {
    root: () => {
      refresh();
      return live?.root ?? null;
    },
    fallbacks: () => live?.fallbacks ?? [],
  };
}
