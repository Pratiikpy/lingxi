/**
 * What each page of a built site loads before it can run (P3): its HTML, the scripts it names, every script those import
 * statically (followed through the chunks' own import statements), its module preloads, its stylesheets and preloaded
 * fonts, each counted gzip-compressed as a server sends it. `pnpm perf:budget` holds every page to its budget.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { gzipSync } from "node:zlib";

export interface PageWeight {
  page: string;
  /** compressed bytes of everything the page loads before it runs */
  total: number;
  scripts: number;
  styles: number;
  html: number;
  files: string[];
}

const gz = (file: string) => gzipSync(readFileSync(file), { level: 6 }).length;

/** The static imports of a built chunk, as paths relative to the site. */
function importsOf(site: string, file: string): string[] {
  const code = readFileSync(join(site, file), "utf8");
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|[;}\s])import\s*(?:[\w$*{}\s,]+from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g)) {
    out.push(
      normalize(join(dirname(file), m[1]!))
        .split("\\")
        .join("/"),
    );
  }
  return out;
}

export function pageWeights(site: string): PageWeight[] {
  const pages = readdirSync(site).filter((f) => f.endsWith(".html"));
  return pages.map((page) => {
    const html = readFileSync(join(site, page), "utf8");
    const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="\.?\/?([^"]+)"[^>]*>/g)]
      .filter((m) => /<script|rel="(modulepreload|stylesheet|preload)"/.test(m[0]))
      .map((m) => m[1]!)
      .filter((f) => !/^https?:/.test(f) && existsSync(join(site, f)));
    const seen = new Set<string>();
    const walk = (f: string) => {
      if (seen.has(f) || !existsSync(join(site, f))) return;
      seen.add(f);
      if (f.endsWith(".js")) for (const d of importsOf(site, f)) walk(d);
    };
    for (const f of refs) walk(f);
    const files = [...seen].sort();
    const scripts = files.filter((f) => f.endsWith(".js")).reduce((n, f) => n + gz(join(site, f)), 0);
    const styles = files
      .filter((f) => !f.endsWith(".js"))
      .reduce((n, f) => n + (f.endsWith(".css") ? gz(join(site, f)) : readFileSync(join(site, f)).length), 0);
    const htmlBytes = gz(join(site, page));
    return {
      page,
      total: scripts + styles + htmlBytes,
      scripts,
      styles,
      html: htmlBytes,
      files: files.map((f) => relative(".", f)),
    };
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("\\").join("/").split("/").pop()!)) {
  for (const w of pageWeights(process.argv[2] ?? "apps/web/dist"))
    console.log(
      `${w.page.padEnd(16)} ${(w.total / 1024).toFixed(1).padStart(7)} KB  scripts ${(w.scripts / 1024).toFixed(1)}  styles+fonts ${(w.styles / 1024).toFixed(1)}  html ${(w.html / 1024).toFixed(1)}  (${w.files.length} files)`,
    );
}
