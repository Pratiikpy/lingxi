/**
 * A4: the files of earlier builds stay served for a while, so a page that was open when a new build went live can still
 * load the parts it asks for later. Before a build empties its folder, every file under `assets/` is copied into a
 * kept folder beside it (`assets-kept/assets/`, which the server reads after the build). A kept file's time is set each
 * time it is seen in a build, so it goes `maxAgeMs` after it left the build; file names carry a hash of their contents,
 * so a kept file and a built file of the same name are the same file.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

export const KEEP_DAYS = 14;
const DAY_MS = 86_400_000;

/** The kept folder for a build folder: beside it. The server looks in the same place (services/api withSite). */
export const keptDirFor = (outDir: string): string => resolve(outDir, "..", "assets-kept");

export function keepAssets(outDir: string, keptDir: string, now = Date.now(), maxAgeMs = KEEP_DAYS * DAY_MS): { kept: number; removed: number } {
  const from = join(outDir, "assets");
  const to = join(keptDir, "assets");
  mkdirSync(to, { recursive: true });
  let kept = 0;
  let removed = 0;
  if (existsSync(from)) {
    for (const name of readdirSync(from)) {
      const dest = join(to, name);
      if (!existsSync(dest)) {
        copyFileSync(join(from, name), dest);
        kept++;
      }
      // still part of the build being replaced: its days start now
      utimesSync(dest, now / 1000, now / 1000);
    }
  }
  for (const name of readdirSync(to)) {
    const file = join(to, name);
    if (now - statSync(file).mtimeMs > maxAgeMs) {
      unlinkSync(file);
      removed++;
    }
  }
  return { kept, removed };
}

/** The site's build (`dist`) keeps the files of the builds before it; other outputs (the on-chain copy) do not. */
export function keepAssetsPlugin(): Plugin {
  let outDir = "";
  return {
    name: "lingxi-keep-assets",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    buildStart() {
      if (!outDir.endsWith(`${"/"}dist`) && !outDir.endsWith("\\dist")) return;
      const r = keepAssets(outDir, keptDirFor(outDir));
      this.info(`kept ${r.kept} files of the build before, removed ${r.removed} older than ${KEEP_DAYS} days`);
    },
  };
}
