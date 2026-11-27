/**
 * A page's own script must load and be the page's code, not a stub (A56). Since R39 and R43 a page may be drawn at
 * build time and start its code from a small loader that imports it: the check follows the loader's imports, so the
 * loader passes when the code it starts answers, and fails when that code is missing or is not JavaScript.
 */
import { describe, expect, it } from "vitest";
import { importsOf, pageScriptLoads } from "./lib/pageScript.mts";

const js = (body: string, status = 200, type = "text/javascript") =>
  new Response(status === 200 ? body : "", { status, headers: { "content-type": type } });
const site = (files: Record<string, Response | (() => Response)>) => async (url: string) => {
  const f = files[new URL(url).pathname];
  if (!f) return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
  return typeof f === "function" ? f() : f.clone();
};

const loader =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./main-tNQxOSL5.js","./errorReport-Ch6K70jX.css"])))=>i.map(i=>d[i]);' +
  'import"./modulepreload-polyfill-B5Qt9EMX.js";import{_ as a}from"./__vite-browser-external-BcWzWDyb.js";' +
  'const e=()=>{a(()=>import("./main-tNQxOSL5.js"),__vite__mapDeps([0,1]),import.meta.url)};setTimeout(e,1500);';
const big = "x".repeat(40_000);

describe("the imports a page's entry script names", () => {
  it("finds static and dynamic imports of the site's own scripts, once each, and no stylesheet", () => {
    expect(importsOf(loader).sort()).toEqual(
      ["./__vite-browser-external-BcWzWDyb.js", "./main-tNQxOSL5.js", "./modulepreload-polyfill-B5Qt9EMX.js"].sort(),
    );
  });
  it("ignores bare package names and outside addresses", () => {
    expect(importsOf('import"react";import("https://cdn.example/x.js");import{a}from"./a-1.js";')).toEqual([
      "./a-1.js",
    ]);
  });
});

describe("a page's script loads (A56)", () => {
  const base = "https://lingxi.example/assets/verify-hYlXHdMh.js";

  it("a bundle of its own passes", async () => {
    const r = await pageScriptLoads(base, { fetchFn: site({ "/assets/verify-hYlXHdMh.js": js(big) }) });
    expect(r).toMatchObject({ ok: true, problems: [] });
  });

  it("a small loader passes when the code it starts answers", async () => {
    const r = await pageScriptLoads(base, {
      fetchFn: site({
        "/assets/verify-hYlXHdMh.js": js(loader),
        "/assets/main-tNQxOSL5.js": js(big),
        "/assets/modulepreload-polyfill-B5Qt9EMX.js": js("export{}"),
        "/assets/__vite-browser-external-BcWzWDyb.js": js("export const _=f=>f();"),
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(40_000);
  });

  it("a loader whose code is missing fails, naming it", async () => {
    const r = await pageScriptLoads(base, {
      fetchFn: site({
        "/assets/verify-hYlXHdMh.js": js(loader),
        "/assets/modulepreload-polyfill-B5Qt9EMX.js": js("export{}"),
        "/assets/__vite-browser-external-BcWzWDyb.js": js("export const _=f=>f();"),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("main-tNQxOSL5.js 404");
  });

  it("code answered as something other than JavaScript fails", async () => {
    const r = await pageScriptLoads(base, {
      fetchFn: site({
        "/assets/verify-hYlXHdMh.js": js(loader),
        "/assets/main-tNQxOSL5.js": js(big, 200, "text/html"),
        "/assets/modulepreload-polyfill-B5Qt9EMX.js": js("export{}"),
        "/assets/__vite-browser-external-BcWzWDyb.js": js("export const _=f=>f();"),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("main-tNQxOSL5.js");
  });

  it("a stub that imports nothing fails", async () => {
    const r = await pageScriptLoads(base, { fetchFn: site({ "/assets/verify-hYlXHdMh.js": js("console.log(1)") }) });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("too small");
  });

  it("the entry itself missing fails", async () => {
    const r = await pageScriptLoads(base, { fetchFn: site({}) });
    expect(r).toMatchObject({ ok: false });
    expect(r.problems.join()).toContain("verify-hYlXHdMh.js 404");
  });
});
