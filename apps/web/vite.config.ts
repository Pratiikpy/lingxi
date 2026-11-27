import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, relative, resolve } from "node:path";
import { hasBannedName, scanNames } from "../../packages/world/src/names";

/** build.json beside the pages: the commit a build came from, so anyone can check what a site is serving. */
function buildStamp(): Plugin {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
  return {
    name: "lingxi-build-stamp",
    generateBundle() {
      let commit = "unknown";
      let dirty = true;
      try {
        commit = git("rev-parse", "HEAD");
        dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
      } catch {
        this.warn("no git checkout: build.json records an unknown commit");
      }
      this.emitFile({
        type: "asset",
        fileName: "build.json",
        source: `${JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() })}\n`,
      });
    },
  };
}

/** The build fails if a name the project must never carry reached its output, in a file's name or its text. */
function namesGuard(): Plugin {
  let outDir = "";
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    );
  return {
    name: "lingxi-names-guard",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const found: string[] = [];
      for (const f of walk(outDir)) {
        const rel = relative(outDir, f).split("\\").join("/");
        if (hasBannedName(rel)) found.push(`file name ${rel}`);
        else if (/\.(js|css|html|json|svg|webmanifest|txt|map)$/.test(f)) {
          const hit = scanNames(readFileSync(f, "utf8"), 1)[0];
          if (hit) found.push(`${rel}:${hit.line} "${hit.context}"`);
        }
      }
      if (found.length)
        throw new Error(`a banned name reached the build output:\n  ${found.slice(0, 20).join("\n  ")}`);
    },
  };
}

/**
 * P6: the service worker's list of what the game needs to open offline (public/sw.js): the game page and every script,
 * style and font of its first screen and of the full game behind it, under this build's version, so each release
 * installs a fresh copy and clears the last. Written into the built sw.js once the bundle is on disk.
 */
function offlineWorker(): Plugin {
  let files: string[] = [];
  let outDir = "";
  return {
    name: "lingxi-offline-worker",
    apply: "build",
    writeBundle(options, bundle) {
      outDir = options.dir ?? "";
      const chunks = Object.values(bundle).filter((c): c is Extract<typeof c, { type: "chunk" }> => c.type === "chunk");
      const norm = (id: string) => id.split("\\").join("/");
      // the game's entry is the chunk Vite builds for play.html (found by name, a module can sit in a shared chunk
      // that is not the one the page loads); then the chunks it reaches without the network
      const entry = chunks.find(
        (c) => c.isEntry && !!c.facadeModuleId && norm(c.facadeModuleId).endsWith("/play.html"),
      );
      const roots = [
        entry,
        ...["/src/play/FirstVisit.tsx", "/src/play/Crash.tsx", "/src/play/PlayApp.tsx"].map((e) =>
          chunks.find((c) => c.moduleIds.some((id) => norm(id).endsWith(e))),
        ),
      ];
      if (roots.some((c) => !c)) {
        this.warn("the game's entry chunks were not found: the offline list is empty");
        return;
      }
      const seen = new Set<string>();
      const walk = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        for (const dep of chunks.find((c) => c.fileName === name)?.imports ?? []) walk(dep);
      };
      for (const c of roots) walk(c!.fileName);
      const css = [...seen].flatMap((f) => [
        ...(chunks.find((c) => c.fileName === f)?.viteMetadata?.importedCss ?? []),
      ]);
      const fonts = Object.keys(bundle).filter(
        (f) => /\.woff2$/.test(f) && /(pixelify-sans|baloo-2)-latin-wght-normal/.test(f),
      );
      files = ["play.html", "manifest.webmanifest", "favicon.png", ...seen, ...new Set(css), ...fonts];
    },
    closeBundle() {
      const sw = join(outDir, "sw.js");
      if (!outDir || !existsSync(sw)) return;
      let version = "unknown";
      try {
        version = `${execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim()}-${Date.now().toString(36)}`;
      } catch {
        version = Date.now().toString(36);
      }
      const text = readFileSync(sw, "utf8");
      if (!text.includes("/*__PRECACHE__*/"))
        throw new Error("sw.js has no /*__PRECACHE__*/ mark for the offline list");
      writeFileSync(sw, text.replace("/*__PRECACHE__*/", `const PRECACHE = ${JSON.stringify({ version, files })};`));
    },
  };
}

/**
 * P3: a page's entry starts once its first frame has painted (play.html, index.html, and since R39 verify.html and
 * handheld.html import it from a small inline module), and the game page fetches its app (PlayApp and everything it
 * imports) only after the save is claimed and the clock is asked, as the handheld fetches its own once it holds the
 * handheld. Neither is a script tag Vite would preload, so this writes `modulepreload` hints for each page's entries
 * and their import closures: the browser fetches and parses them from the start without running them, so nothing reads
 * the save before this tab holds the game (P1). The two latin web fonts the first screen is set in are preloaded, so the
 * prerendered screen paints in them (a later swap re-set its words a little larger, which counted as a second, later
 * first screen), and the pages' stylesheets are applied from the start, since the prerendered screens paint with them
 * (the page's own loader skips a stylesheet already on it).
 *
 * `saved` entries are preloaded only for a visitor with a pet saved on this device (a small script in the page checks the
 * save, as the hatch screen's own picker does): a first visit runs the standalone hatch screen and fetches the rest of
 * the game behind it (FirstVisit.tsx), so preloading all of it would make the first screen wait on code it never runs.
 * Every stylesheet of both lists is applied from the start for everyone, so the cascade is the same on every visit.
 */
const PRELOADED: ReadonlyArray<{ page: string; entries: readonly string[]; saved?: readonly string[] }> = [
  {
    page: "play.html",
    entries: ["/src/play/main.tsx", "/src/play/FirstVisit.tsx", "/src/play/Crash.tsx"],
    saved: ["/src/play/PlayApp.tsx"],
  },
  { page: "index.html", entries: ["/src/landing/main.tsx"] },
  // R39: the proof page and the handheld are rendered at build time and start their code after their first paint too;
  // each page's app (VerifyApp, HandheldApp, and everything it imports), loaded after the entry (the handheld's once
  // the tab holds the handheld), is preloaded from the start, so its stylesheet styles the prerendered screen and its
  // code is not a second wait
  { page: "verify.html", entries: ["/src/verify/main.tsx", "/src/verify/VerifyApp.tsx"] },
  { page: "handheld.html", entries: ["/src/handheld/main.tsx", "/src/handheld/HandheldApp.tsx"] },
  // the other pages load their code from the page itself; what they gain here is their two web fonts from the start, so
  // the page is not restyled and laid out again when the fonts arrive after it has drawn (P3)
  { page: "numbers.html", entries: [] },
  { page: "tree.html", entries: [] },
  { page: "agents.html", entries: [] },
  { page: "privacy.html", entries: [] },
  { page: "terms.html", entries: [] },
  // the circuit catalogue and the not-found page carry no React, only the brand's stylesheet and its two fonts (R27)
  { page: "circuits.html", entries: [] },
  { page: "404.html", entries: [] },
];

function preloadPages(): Plugin {
  return {
    name: "lingxi-preload-pages",
    apply: "build",
    writeBundle(options, bundle) {
      const chunks = Object.values(bundle).filter((c): c is Extract<typeof c, { type: "chunk" }> => c.type === "chunk");
      const fonts = Object.keys(bundle).filter((f) =>
        /\/(pixelify-sans|baloo-2)-latin-wght-normal-[^/]+\.woff2$/.test(`/${f}`),
      );
      for (const { page, entries, saved = [] } of PRELOADED) {
        const file = join(options.dir ?? "", page);
        // each entry is a dynamic one by this hook (its facade id is gone), found by the module it holds
        const find = (list: readonly string[]) =>
          list.map((e) =>
            chunks.find((c) => c.isDynamicEntry && c.moduleIds.some((id) => id.split("\\").join("/").endsWith(e))),
          );
        const found = find(entries);
        const foundSaved = find(saved);
        if (!existsSync(file) || [...found, ...foundSaved].some((c) => !c)) {
          this.warn(
            `${page} or one of its entries (${[...entries, ...saved].join(", ")}) not found: no preload written`,
          );
          continue;
        }
        const closure = (roots: typeof found, files = new Set<string>()) => {
          const walk = (name: string) => {
            if (files.has(name)) return;
            files.add(name);
            for (const dep of chunks.find((c) => c.fileName === name)?.imports ?? []) walk(dep);
          };
          for (const c of roots) walk(c!.fileName);
          return files;
        };
        const files = closure(found);
        const later = [...closure(foundSaved)].filter((f) => !files.has(f));
        const html = readFileSync(file, "utf8");
        const already = new Set([...html.matchAll(/href="\.\/([^"]+)"/g)].map((m) => m[1]));
        const css = [
          ...new Set(
            [...files, ...later].flatMap((f) => [
              ...(chunks.find((c) => c.fileName === f)?.viteMetadata?.importedCss ?? []),
            ]),
          ),
        ];
        // a visitor with a pet saved fetches the rest of the game from the start too (the check is the hatch screen
        // picker's own; a storage that cannot be read counts as a save, so the full game is never starved)
        const forSaved = later.length
          ? `<script>(function(){try{if(!(localStorage.getItem("lingxi.pets.v2")||localStorage.getItem("lingxi.pet.v1")))return}catch(e){}${JSON.stringify(later.filter((f) => !already.has(f)))}.forEach(function(f){var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href="./"+f;document.head.appendChild(l)})})()</script>`
          : "";
        const sheets = css
          .filter((f) => !already.has(f))
          .map((f) => `<link rel="stylesheet" crossorigin href="./${f}">`);
        const fontLinks = fonts.map(
          (f) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="./${f}">`,
        );
        const code = [
          ...[...files]
            .filter((f) => !already.has(f))
            .map((f) => `<link rel="modulepreload" crossorigin href="./${f}">`),
          ...(forSaved ? [forSaved] : []),
        ];
        // R39: a page painted from its HTML (one with entries here) names what that paint needs, its stylesheets and the
        // fonts it is set in, before its own script, which runs only after the paint: over HTTP/1.1 a browser opens six
        // connections to a host and the files named first take them, so a stylesheet named after the scripts waited a
        // round trip behind them, and fonts that came after the paint set its words again (a second layout, and a swap
        // the reader sees). A page that draws with its script keeps its fonts after the script, as before
        const first = sheets.length ? [...sheets, ...fontLinks] : [];
        const last = sheets.length ? code : [...fontLinks, ...code];
        const script = html.indexOf('<script type="module"');
        const withFirst = !first.length
          ? html
          : script >= 0 && script < html.indexOf("</head>")
            ? `${html.slice(0, script)}${first.join("\n    ")}\n    ${html.slice(script)}`
            : html.replace("</head>", `  ${first.join("\n    ")}\n  </head>`);
        writeFileSync(file, withFirst.replace("</head>", `  ${last.join("\n    ")}\n  </head>`));
      }
    },
  };
}

/**
 * R27: the not-found page is sent for any address the site does not have, at any depth (/a/b/c), so every file it names
 * is named from the site's root: the build writes them beside the page (./assets/...), which at /a/b/c would be asked
 * for at /a/b/assets/... and not found.
 */
function rootedNotFound(): Plugin {
  let outDir = "";
  return {
    name: "lingxi-rooted-not-found",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const page = join(outDir, "404.html");
      if (!existsSync(page)) return;
      const html = readFileSync(page, "utf8").replace(/\b(href|src)="\.\//g, '$1="/');
      if (/\b(?:href|src)="(?!\/|https:|#)/.test(html))
        throw new Error("404.html names a file not from the site's root");
      writeFileSync(page, html);
    },
  };
}

/**
 * A build with no server (an empty `VITE_API_URL`: the on-chain copy, or a site served on its own) reads the letters to
 * every player from `mail.json` beside its pages, since there is no server to ask (H11). The file is the server's own
 * (services/api/mail/letters.json), shipped by every such build: it was once copied only by the DeWEB script, so another
 * server-less build asked for a file it did not have (P3a).
 */
function shipLetters(): Plugin {
  return {
    name: "lingxi-ship-letters",
    apply: "build",
    generateBundle() {
      if (process.env.VITE_API_URL !== "") return;
      this.emitFile({
        type: "asset",
        fileName: "mail.json",
        source: readFileSync(resolve(__dirname, "../../services/api/mail/letters.json"), "utf8"),
      });
    },
  };
}

/**
 * P3: a page's first screen is rendered at build time by a server-side build of its prerender.tsx, kept inside apps/web
 * so Node resolves React from here; `run` is given the URL of its entry file (imported under a query of its own, a copy
 * of that file holds its own copy of the modules in it and of their stores). The pages' modules read `location` as they
 * load when no API address is built in (a plain build, as CI's): the render gets a neutral one for as long as it runs, so
 * no module takes it for a local or live host.
 *
 * Rollup runs every plugin's closeBundle at once, and the renders share those globals (the location, and the language a
 * copy starts in, `perLanguage`), so the pages are rendered one after another: no page's render can end, taking the
 * shared location away, while another page's modules are still loading.
 */
let prerenderQueue: Promise<unknown> = Promise.resolve();
function withPrerender<T>(entry: string, tmpName: string, run: (href: string) => Promise<T>): Promise<T> {
  const turn = prerenderQueue.then(() => prerenderOne(entry, tmpName, run));
  prerenderQueue = turn.catch(() => undefined);
  return turn;
}

async function prerenderOne<T>(entry: string, tmpName: string, run: (href: string) => Promise<T>): Promise<T> {
  const tmp = resolve(__dirname, tmpName);
  const { build } = await import("vite");
  await build({
    root: __dirname,
    configFile: false,
    logLevel: "warn",
    plugins: [react()],
    build: {
      ssr: resolve(__dirname, entry),
      outDir: tmp,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "prerender.mjs", format: "esm" } },
    },
    ssr: { noExternal: [/^@lingxi\//] },
  });
  const g = globalThis as { location?: unknown };
  const hadLocation = "location" in g;
  if (!hadLocation) g.location = new URL("https://lingxi.invalid/");
  try {
    return await run(pathToFileURL(join(tmp, "prerender.mjs")).href);
  } finally {
    if (!hadLocation) delete g.location;
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * P3: the landing's HTML rendered at build time in both languages, so a slow phone paints the headline and copy before
 * any of the page's script arrives. src/landing/prerender.tsx renders each language (`withPrerender`); both are written
 * into the built index.html, a small inline script shows the reader's one (saved choice, else the browser's language,
 * as i18n's own first guess), and React then renders the same page over it.
 */
function prerenderLanding(): Plugin {
  let outDir = "";
  return {
    name: "lingxi-prerender-landing",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    async closeBundle() {
      const page = join(outDir, "index.html");
      if (!existsSync(page)) return;
      await withPrerender("src/landing/prerender.tsx", ".prerender", async (href) => {
        const mod = (await import(href)) as { render: (lang: "en" | "zh") => string };
        const [en, zh] = [mod.render("en"), mod.render("zh")];
        // a storage that cannot be read falls back to the browser's own language, as a first visit does
        const pick = `<script>(function(){var l;try{l=localStorage.getItem("lingxi.lang")}catch(e){}if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";if(l==="zh"){var r=document.getElementById("root").children;r[0].hidden=true;r[1].hidden=false;document.documentElement.lang="zh-CN"}})()</script>`;
        const html = readFileSync(page, "utf8");
        if (!html.includes('<div id="root"></div>')) throw new Error("index.html has no empty #root to fill");
        writeFileSync(
          page,
          html.replace(
            '<div id="root"></div>',
            `<div id="root"><div data-prerender="en">${en}</div><div data-prerender="zh" hidden>${zh}</div></div>${pick}`,
          ),
        );
      });
    },
  };
}

/** Each language's copy of a prerender module: imported under its own query, its language store starts in that language. */
async function perLanguage<M>(href: string): Promise<Record<"en" | "zh", M>> {
  const g = globalThis as { __lingxiPrerenderLang?: string };
  try {
    const mods: Partial<Record<"en" | "zh", M>> = {};
    for (const lang of ["en", "zh"] as const) {
      g.__lingxiPrerenderLang = lang;
      mods[lang] = (await import(`${href}?lang=${lang}`)) as M;
    }
    return mods as Record<"en" | "zh", M>;
  } finally {
    delete g.__lingxiPrerenderLang;
  }
}

/**
 * P3: the game's first screen for a first visit (the hatch screen), rendered at build time in both languages and written
 * into play.html, so a new player sees it before any of the game's script has arrived on a slow phone. Each language is
 * rendered in its own copy of the modules (imported under its own query), whose language store starts in that language
 * (i18n's `initialLang` reads `__lingxiPrerenderLang`). A small inline script shows the reader's screen only when this
 * browser holds no save: a returning player keeps the splash, since their game, not the hatch, is coming. Both screens wait
 * in templates, and only the reader's is put in the page, inside an inert `[data-prerender]` with a note that the game
 * is getting ready, until the game renders over it, so a tap is never silently lost.
 */
function prerenderPlay(): Plugin {
  let outDir = "";
  return {
    name: "lingxi-prerender-play",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    async closeBundle() {
      const page = join(outDir, "play.html");
      if (!existsSync(page)) return;
      await withPrerender("src/play/prerender.tsx", ".prerender-play", async (href) => {
        const mods = await perLanguage<{ render: () => string }>(href);
        const screens = { en: mods.en.render(), zh: mods.zh.render() };
        const ready = { en: "Getting the game ready…", zh: "游戏准备中……" };
        // each language waits in a template, which the page does not render, so only the reader's screen is ever in it
        // (two would repeat its ids and its landmark)
        const shown = (lang: "en" | "zh") =>
          `<template data-prerender="${lang}">${screens[lang]}<p class="pre-ready" role="status">${ready[lang]}</p></template>`;
        // a pet store that cannot be read counts as a save, so the full game is never starved; a language that cannot be
        // read falls back to the browser's own
        const pick = `<script>(function(){var s=null;try{s=localStorage.getItem("lingxi.pets.v2")||localStorage.getItem("lingxi.pet.v1")}catch(e){s="?"}if(s!==null)return;var l=null;try{l=localStorage.getItem("lingxi.lang")}catch(e){}if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";var r=document.getElementById("root");var t=r.querySelector('template[data-prerender="'+l+'"]');var d=document.createElement("div");d.setAttribute("data-prerender",l);d.setAttribute("aria-busy","true");d.inert=true;d.appendChild(t.content.cloneNode(true));r.querySelector(".boot-splash").hidden=true;r.appendChild(d);if(l==="zh")document.documentElement.lang="zh-CN"})()</script>`;
        const style = `<style>.pre-ready{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);margin:0;padding:6px 14px;border:2px solid #2b2140;border-radius:999px;background:#fffdf8;color:#2b2140;font:600 13px/1.3 system-ui,sans-serif;z-index:10}</style>`;
        const html = readFileSync(page, "utf8");
        const splash = html.match(/<div id="root">(<div class="boot-splash"[\s\S]*?<\/div>)<\/div>/);
        if (!splash) throw new Error("play.html has no splash inside #root to keep beside the hatch screen");
        writeFileSync(
          page,
          html.replace(splash[0], `<div id="root">${splash[1]}${shown("en")}${shown("zh")}</div>${pick}${style}`),
        );
      });
    },
  };
}

/**
 * R39: the pages that painted nothing until every one of their scripts had arrived and run (an empty #root, some forty
 * files) are rendered at build time too, so a slow phone paints the page's own header, words and controls first: the
 * proof page (its explanation, the pet's waiting card and its tables of endpoints, circuits, rules and contracts, each
 * as it reads before X Layer has answered) and the handheld (the device, its keys and what it is doing). Each page's
 * prerender.tsx is rendered once per language (`perLanguage`), and once per variant it names: `variantKeys` are storage
 * keys, and a browser holding any of them gets the `+aboard` render (the handheld says it is bringing a pet aboard).
 *
 * Every render waits in a template, so only the reader's is ever in the page (two would repeat its ids and landmarks),
 * and a small script puts it in #root as the page is read, choosing as the page's first render will: the language as
 * i18n's first guess does (saved choice, else the browser's), the variant from storage, and `fill`, the state the first
 * render reads from the address. Until the page's script renders the same screen over it, its controls are inert, so a
 * tap or a typed number is never taken by a control that cannot answer yet (the form would reload the page); its links
 * are links and work at once. The wrapper is `display: contents`, so the screen lays out exactly as the page's own.
 * (Hydrating the screen instead of rendering over it was measured too: under the same throttling it blocked the page
 * no less, so the pages keep the simpler render the landing and the game use.)
 */
const PRERENDERED: ReadonlyArray<{ page: string; entry: string; fill?: string }> = [
  {
    page: "verify.html",
    entry: "src/verify/prerender.tsx",
    // the pet named in the address is the one the page reads first, and its box shows that number (petRead.ts)
    fill: 'var h=location.hash.slice(1),i=d.querySelector("#pet-id");if(i&&/^\\d{1,10}$/.test(h))i.value=h;',
  },
  { page: "handheld.html", entry: "src/handheld/prerender.tsx" },
];

function prerenderPages(): Plugin {
  let outDir = "";
  return {
    name: "lingxi-prerender-pages",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    async closeBundle() {
      // one page after the other: each is a build of its own
      for (const { page, entry, fill = "" } of PRERENDERED) {
        const file = join(outDir, page);
        if (!existsSync(file)) continue;
        await withPrerender(entry, `.prerender-${page.replace(/\.html$/, "")}`, async (href) => {
          type Mod = { render: (variant: boolean) => string; variantKeys?: readonly string[] };
          const mods = await perLanguage<Mod>(href);
          const keys = mods.en.variantKeys ?? [];
          // a module the two copies share (split out of the entry file) would hold one language store for both
          if (mods.en.render(false) === mods.zh.render(false))
            throw new Error(
              `${page}: its English and Chinese renders are the same; each language needs its own modules`,
            );
          const screens = (["en", "zh"] as const).flatMap((lang) =>
            [false, ...(keys.length ? [true] : [])].map(
              (v) => `<template data-prerender="${lang}${v ? "+aboard" : ""}">${mods[lang].render(v)}</template>`,
            ),
          );
          const variant = keys.length
            ? `try{if(${JSON.stringify(keys)}.some(function(k){return localStorage.getItem(k)!==null}))v="+aboard"}catch(e){}`
            : "";
          const pick = `<script>(function(){var l=null,v="";try{l=localStorage.getItem("lingxi.lang")}catch(e){}if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";${variant}var r=document.getElementById("root"),t=r.querySelector('template[data-prerender="'+l+v+'"]'),d=document.createElement("div");d.setAttribute("data-prerender",l);d.setAttribute("aria-busy","true");d.style.display="contents";d.appendChild(t.content.cloneNode(true));d.querySelectorAll("button,input,select,textarea").forEach(function(e){e.inert=true});${fill}r.appendChild(d);if(l==="zh")document.documentElement.lang="zh-CN"})()</script>`;
          const html = readFileSync(file, "utf8");
          if (!html.includes('<div id="root"></div>')) throw new Error(`${page} has no empty #root to fill`);
          writeFileSync(file, html.replace('<div id="root"></div>', `<div id="root">${screens.join("")}</div>${pick}`));
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    buildStamp(),
    namesGuard(),
    preloadPages(),
    offlineWorker(),
    prerenderLanding(),
    prerenderPlay(),
    prerenderPages(),
    shipLetters(),
    rootedNotFound(),
  ],
  base: "./",
  build: {
    target: "es2022",
    // R29: the Chinese titles' pixel face is its own file, fetched only by a page that draws one of them; inlined (it
    // is under Vite's 4 KB limit) it would ride in every page's stylesheet for every reader
    assetsInlineLimit: (file) => (file.endsWith("lingxi-pixel-cjk.woff2") ? false : undefined),
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        play: resolve(__dirname, "play.html"),
        verify: resolve(__dirname, "verify.html"),
        agents: resolve(__dirname, "agents.html"),
        tree: resolve(__dirname, "tree.html"),
        numbers: resolve(__dirname, "numbers.html"),
        handheld: resolve(__dirname, "handheld.html"),
        privacy: resolve(__dirname, "privacy.html"),
        terms: resolve(__dirname, "terms.html"),
        // R27: the two pages without React, built here so they carry the brand's fonts and tokens like every other
        circuits: resolve(__dirname, "circuits.html"),
        notFound: resolve(__dirname, "404.html"),
      },
    },
  },
  // the end-to-end suite (e2e/) plays a dev server that must not reload a page under a running test when a file is
  // saved; its reload channel stays, since Vite uses it to reload a page after bundling a newly found dependency
  // under the suite it also transforms the game's source as it starts, so a dependency it finds is bundled before any
  // test loads a page (a cold CI machine otherwise found one mid-load, and the page could not load)
  server: {
    port: 5199,
    ...(process.env.LINGXI_E2E === "1"
      ? { watch: null, warmup: { clientFiles: ["./src/**/main.tsx", "./src/**/*.tsx", "!./src/**/*.test.tsx"] } }
      : {}),
  },
  // the end-to-end suite gives each run its own dependency cache, so runs never share one and each starts as CI does
  ...(process.env.LINGXI_VITE_CACHE ? { cacheDir: process.env.LINGXI_VITE_CACHE } : {}),
});
