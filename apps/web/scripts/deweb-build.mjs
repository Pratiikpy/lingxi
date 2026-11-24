/**
 * The on-chain (DeWEB) build: the same game with no server features, every path
 * relative, and only the art the code actually uses, made smaller where it pays.
 *
 *   node scripts/deweb-build.mjs            → dist-deweb/ and dist-deweb.manifest.json
 *
 * What changes from the web build, and why:
 *   - no API or live-room address, so teaching by words, live rooms and reminders
 *     stay off (they need a server; Pet School lessons and hand-built rules still work);
 *   - the letters to every player ship beside the page as mail.json (the server's own
 *     file, written by the build for any build with no server), so the copy has its mailbox
 *     and welcome gift; the game leaves out letters marked as needing the server;
 *   - art files no script, stylesheet or page names are left out (the public folder
 *     holds the whole source art set, most of which the game never shows);
 *   - big animated rooms are re-encoded with a smaller palette, and sounds as 64 kbps
 *     mono, because every byte is paid for once, on chain.
 * Chain reads go to X Layer's official nodes, which DeWEB counts as on-chain.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-deweb");

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const rel = (f) => relative(out, f).split("\\").join("/");

rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", "dist-deweb", "--emptyOutDir"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, VITE_CHAIN: "xlayer", VITE_API_URL: "", VITE_LIVE_URL: "", VITE_RPC: "", VITE_OFFLINE: "off" },
});

// 1. keep only art the bundle names (by file name, since some paths are built from data)
const code = walk(out)
  .filter((f) => /\.(js|css|html|json|webmanifest)$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
let dropped = 0;
let droppedBytes = 0;
for (const f of walk(join(out, "art"))) {
  if (!code.includes(basename(f))) {
    droppedBytes += statSync(f).size;
    rmSync(f);
    dropped++;
  }
}
// the service worker exists only for reminders, which this build does not offer
rmSync(join(out, "sw.js"), { force: true });
// the letters to every player (H11) are shipped as mail.json by the build itself, as for any build with no server

// 2. smaller heavy files, same names
let saved = 0;
for (const f of walk(join(out, "art"))) {
  const size = statSync(f).size;
  const tmp = `${f}.tmp${f.slice(f.lastIndexOf("."))}`;
  try {
    if (f.endsWith(".gif") && size > 600_000) {
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", f, "-filter_complex", "split[a][b];[a]palettegen=max_colors=48:stats_mode=full[p];[b][p]paletteuse=dither=none", tmp]);
    } else if ((f.endsWith(".mp3") || f.endsWith(".wav")) && size > 60_000) {
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", f, "-ac", "1", "-b:a", "64k", tmp.replace(/\.wav$/, ".mp3")]);
      if (f.endsWith(".wav")) continue; // keep the original format and name for wav
    } else continue;
    if (statSync(tmp).size < size) {
      saved += size - statSync(tmp).size;
      renameSync(tmp, f);
    } else rmSync(tmp);
  } catch {
    rmSync(tmp, { force: true });
  }
}

// 3. a manifest the publish script uploads from
const files = walk(out)
  .filter((f) => !f.includes(".tmp."))
  .map((f) => {
    const data = readFileSync(f);
    return { path: rel(f), size: data.length, sha256: `0x${createHash("sha256").update(data).digest("hex")}` };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const total = files.reduce((n, f) => n + f.size, 0);
const big = files.filter((f) => f.size > 8_400_000);
if (big.length) throw new Error(`files over DeWEB's 8.4 MB limit: ${big.map((f) => f.path).join(", ")}`);
if (files.length > 5000) throw new Error("more than 5,000 paths");
writeFileSync(join(root, "dist-deweb.manifest.json"), JSON.stringify({ files, total }, null, 1));
console.log(`dropped ${dropped} unused art files (${(droppedBytes / 1e6).toFixed(1)} MB), saved ${(saved / 1e6).toFixed(1)} MB re-encoding; ${files.length} files, ${(total / 1e6).toFixed(2)} MB to publish`);
