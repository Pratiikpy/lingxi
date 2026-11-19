/**
 * A10: the site's releases, from the release command's side (the server's is services/api/src/releases.ts). A release is
 * checked before it goes live, goes live by replacing the pointer, can be rolled back the same way, and is let go
 * fourteen days after it stopped being live, which is how long a page left open may still ask for its files (A4).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listReleases, readPointer, releasesDir, writePointer } from "../../services/api/src/releases.ts";

/** How long a release's files stay served after it stopped being live: a page left open may still ask for them. */
export const KEEP_DAYS = 14;
const DAY_MS = 86_400_000;

/** Every page the site has (apps/web/vite.config.ts builds exactly these; scripts/release.test.mts checks the two agree). */
export const PAGES = ["index.html", "play.html", "verify.html", "agents.html", "tree.html", "numbers.html", "handheld.html"] as const;

/** A release's name: when it was built (UTC, to the second) and the commit, `-dirty` when built from uncommitted work. */
export function releaseName(builtAt: number, commit: string, dirty: boolean): string {
  const stamp = new Date(builtAt).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${commit.slice(0, 12).toLowerCase()}${dirty ? "-dirty" : ""}`;
}

/** What keeps a built folder from going live: a page missing, a file a page names missing, or no build.json. */
export function checkRelease(dir: string): string[] {
  const problems: string[] = [];
  for (const page of PAGES) {
    const file = join(dir, page);
    if (!existsSync(file)) {
      problems.push(`${page} is missing`);
      continue;
    }
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g)) {
      if (!existsSync(join(dir, m[1]!))) problems.push(`${page} names ${m[1]}, which the release does not have`);
    }
  }
  if (!existsSync(join(dir, "build.json"))) problems.push("build.json is missing");
  return problems;
}

/** When each release went live and stopped being live (ms), kept beside the pointer. */
type History = Record<string, { live: number; retired?: number }>;
const historyFile = (site: string) => join(site, "history.json");
function readHistory(site: string): History {
  try {
    return JSON.parse(readFileSync(historyFile(site), "utf8")) as History;
  } catch {
    return {};
  }
}
function writeHistory(site: string, h: History): void {
  writeFileSync(`${historyFile(site)}.next`, `${JSON.stringify(h, null, 1)}\n`);
  renameSync(`${historyFile(site)}.next`, historyFile(site));
}

/** Points the site at `next`, the live release becoming the one before it, and records when. */
function point(site: string, next: string, now: number): void {
  const live = readPointer(site);
  writePointer(site, { release: next, ...(live && live.release !== next ? { previous: live.release } : {}) });
  const h = readHistory(site);
  if (live && live.release !== next) h[live.release] = { ...(h[live.release] ?? { live: now }), retired: now };
  h[next] = { live: now };
  writeHistory(site, h);
}

/** Makes a built release live, once it passes the check; throws, leaving the live release as it was, when it does not. */
export function makeLive(site: string, name: string, now: number): void {
  const problems = checkRelease(join(releasesDir(site), name));
  if (problems.length) throw new Error(`release ${name} is incomplete, so it was not made live:\n  ${problems.join("\n  ")}`);
  point(site, name, now);
}

/** Makes the release before the live one live again; returns its name. */
export function rollback(site: string, now: number): string {
  const live = readPointer(site);
  if (!live) throw new Error("nothing is live, so there is nothing to roll back");
  if (!live.previous) throw new Error(`no release before ${live.release} is kept, so there is nothing to roll back to`);
  const back = live.previous;
  point(site, back, now);
  return back;
}

/**
 * Lets releases go: one that stopped being live more than KEEP_DAYS ago, and one that was never live. The live release
 * and the one before it always stay. Returns the names removed, oldest first.
 */
export function prune(site: string, now: number, keepDays = KEEP_DAYS): string[] {
  const live = readPointer(site);
  const keep = new Set([live?.release, live?.previous].filter(Boolean));
  const h = readHistory(site);
  const gone: string[] = [];
  for (const name of [...listReleases(site)].reverse()) {
    if (keep.has(name)) continue;
    const seen = h[name];
    const retired = seen?.retired ?? seen?.live;
    if (seen && retired !== undefined && now - retired < keepDays * DAY_MS) continue;
    rmSync(join(releasesDir(site), name), { recursive: true, force: true, maxRetries: 5 });
    delete h[name];
    gone.push(name);
  }
  if (gone.length) writeHistory(site, h);
  return gone;
}

/**
 * Takes a build made before releases (`dist`), with the files kept from the builds before it (`kept`, holding
 * `assets/`), as a release, and makes it live: the pages open today keep finding their files.
 */
export function adopt(site: string, dist: string, kept: string | null, now: number): string {
  const info = JSON.parse(readFileSync(join(dist, "build.json"), "utf8")) as { commit: string; dirty?: boolean; builtAt: string };
  const name = releaseName(Date.parse(info.builtAt), info.commit, info.dirty === true);
  const into = join(releasesDir(site), name);
  if (existsSync(into)) throw new Error(`release ${name} already exists`);
  mkdirSync(releasesDir(site), { recursive: true });
  cpSync(dist, into, { recursive: true });
  if (kept && existsSync(join(kept, "assets"))) {
    for (const file of readdirSync(join(kept, "assets"))) {
      const to = join(into, "assets", file);
      // names carry a hash of their contents: a file the build already has is the same file
      if (!existsSync(to) && statSync(join(kept, "assets", file)).isFile()) cpSync(join(kept, "assets", file), to);
    }
  }
  makeLive(site, name, now);
  return name;
}
