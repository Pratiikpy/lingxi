/**
 * Whether a live page's own script loads and is the page's code, not a stub (A56). A 200 from a page shell is not a
 * page: its entry script must answer as JavaScript. Since R39 and R43 a page drawn at build time starts its code from a
 * small loader that imports it, so the entry alone can be under a kilobyte; the check follows the site's own scripts
 * the entry imports, statically or not, one step deep, and every one of them must answer as JavaScript. The page's code,
 * the entry and those imports together, must reach MIN_BYTES: a stub that imports nothing stays a failure.
 */
import { steadyFetch, type SteadyOptions } from "./steadyFetch.mts";

/** Less code than this, the entry and what it imports together, is a stub rather than a page. */
export const MIN_BYTES = 1_000;

/** The site's own scripts an entry imports (`import"./x.js"`, `from"./x.js"`, `import("./x.js")`), once each. */
export function importsOf(js: string): string[] {
  const found = new Set<string>();
  for (const m of js.matchAll(/(?:\bimport\s*\(?\s*|\bfrom\s*)["'](\.{1,2}\/[^"']+\.js)["']/g))
    found.add(m[1] as string);
  return [...found];
}

export interface ScriptLoad {
  ok: boolean;
  /** bytes of JavaScript read: the entry and the scripts it imports */
  bytes: number;
  problems: string[];
}

const isJs = (res: Response) => /javascript/.test(res.headers.get("content-type") ?? "");
const name = (url: string) => new URL(url).pathname.split("/").pop() ?? url;

/** Reads the entry script at `url` and the site's own scripts it imports, and says whether the page's code loads. */
export async function pageScriptLoads(url: string, o: SteadyOptions = {}): Promise<ScriptLoad> {
  const problems: string[] = [];
  const entry = (await steadyFetch(url, o)).res;
  if (!entry.ok || !isJs(entry)) return { ok: false, bytes: 0, problems: [`${name(url)} ${entry.status}`] };
  const body = await entry.text();
  let bytes = body.length;
  for (const rel of importsOf(body)) {
    const at = new URL(rel, url).href;
    const res = (await steadyFetch(at, o)).res;
    if (!res.ok || !isJs(res)) {
      problems.push(`${name(at)} ${res.status}${res.ok ? ` (${res.headers.get("content-type") ?? "no type"})` : ""}`);
      continue;
    }
    bytes += (await res.text()).length;
  }
  if (!problems.length && bytes < MIN_BYTES) problems.push(`${name(url)} too small to be the page (${bytes} bytes)`);
  return { ok: !problems.length, bytes, problems };
}
