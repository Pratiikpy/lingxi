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
      this.emitFile({ type: "asset", fileName: "build.json", source: `${JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() })}\n` });
    },
  };
}

/** The build fails if a name the project must never carry reached its output, in a file's name or its text. */
function namesGuard(): Plugin {
  let outDir = "";
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
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
      if (found.length) throw new Error(`a banned name reached the build output:\n  ${found.slice(0, 20).join("\n  ")}`);
    },
  };
}

/**
 * P3: the game page fetches its app (PlayApp and everything it imports) only after the save is claimed and the clock is
 * asked, so on a slow phone the download waited about two seconds for nothing. `modulepreload` hints for those chunks are
 * written into play.html: the browser fetches and parses them from the start without running them, so nothing reads
 * the save before this tab holds the game (P1).
 */
function preloadGame(): Plugin {
  return {
    name: "lingxi-preload-game",
    apply: "build",
    writeBundle(options, bundle) {
      const chunks = Object.values(bundle).filter((c): c is Extract<typeof c, { type: "chunk" }> => c.type === "chunk");
      // the game app's own chunk: a dynamic entry holding src/play/PlayApp.tsx (its facade id is gone by this hook)
      const app = chunks.find((c) => c.isDynamicEntry && c.moduleIds.some((id) => id.split("\\").join("/").endsWith("/src/play/PlayApp.tsx")));
      const file = join(options.dir ?? "", "play.html");
      if (!app || !existsSync(file)) return this.warn("play.html or the PlayApp chunk not found: no preload written");
      const files = new Set<string>();
      const walk = (name: string) => {
        if (files.has(name)) return;
        files.add(name);
        for (const dep of chunks.find((c) => c.fileName === name)?.imports ?? []) walk(dep);
      };
      walk(app.fileName);
      const html = readFileSync(file, "utf8");
      const already = new Set([...html.matchAll(/href="\.\/([^"]+)"/g)].map((m) => m[1]));
      const css = [...files].flatMap((f) => [...(chunks.find((c) => c.fileName === f)?.viteMetadata?.importedCss ?? [])]);
      // the game's stylesheets are applied from the start, not only fetched: the prerendered hatch screen (prerenderPlay)
      // paints with them, and the game's own loader skips a stylesheet already on the page
      const links = [...[...files].filter((f) => !already.has(f)).map((f) => `<link rel="modulepreload" crossorigin href="./${f}">`), ...css.filter((f) => !already.has(f)).map((f) => `<link rel="stylesheet" crossorigin href="./${f}">`)];
      writeFileSync(file, html.replace("</head>", `  ${links.join("\n    ")}\n  </head>`));
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
      this.emitFile({ type: "asset", fileName: "mail.json", source: readFileSync(resolve(__dirname, "../../services/api/mail/letters.json"), "utf8") });
    },
  };
}

/**
 * P3: the landing's HTML rendered at build time in both languages, so a slow phone paints the headline and copy before
 * any of the page's script arrives. A second, server-side build of src/landing/prerender.tsx (kept inside apps/web so
 * Node resolves React from here) renders each language; both are written into the built index.html, a small inline
 * script shows the reader's one (saved choice, else the browser's language, as i18n's own first guess), and React then
 * renders the same page over it.
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
      const tmp = resolve(__dirname, ".prerender");
      const { build } = await import("vite");
      await build({
        root: __dirname,
        configFile: false,
        logLevel: "warn",
        plugins: [react()],
        build: { ssr: resolve(__dirname, "src/landing/prerender.tsx"), outDir: tmp, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "prerender.mjs", format: "esm" } } },
        ssr: { noExternal: [/^@lingxi\//] },
      });
      // the landing's modules read `location` as they load when no API address is built in (a plain build, as CI's):
      // the render gets a neutral one for as long as it runs, so no module takes it for a local or live host
      const g = globalThis as { location?: unknown };
      const hadLocation = "location" in g;
      if (!hadLocation) g.location = new URL("https://lingxi.invalid/");
      try {
        const mod = (await import(pathToFileURL(join(tmp, "prerender.mjs")).href)) as { render: (lang: "en" | "zh") => string };
        const [en, zh] = [mod.render("en"), mod.render("zh")];
        const pick = `<script>(function(){var l;try{l=localStorage.getItem("lingxi.lang")}catch(e){}if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";if(l==="zh"){var r=document.getElementById("root").children;r[0].hidden=true;r[1].hidden=false;document.documentElement.lang="zh-CN"}})()</script>`;
        const html = readFileSync(page, "utf8");
        if (!html.includes('<div id="root"></div>')) throw new Error("index.html has no empty #root to fill");
        writeFileSync(page, html.replace('<div id="root"></div>', `<div id="root"><div data-prerender="en">${en}</div><div data-prerender="zh" hidden>${zh}</div></div>${pick}`));
      } finally {
        if (!hadLocation) delete g.location;
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

/**
 * P3: the game's first screen for a first visit (the hatch screen), rendered at build time in both languages and written
 * into play.html, so a new player sees it before any of the game's script has arrived on a slow phone. Each language is
 * rendered in its own copy of the modules (imported under its own query), whose language store starts in that language
 * (i18n's `initialLang` reads `__lingxiPrerenderLang`). A small inline script shows the reader's screen only when this
 * browser holds no save: a returning player keeps the splash, since their game, not the hatch, is coming. The screen is
 * inert, with a note that the game is getting ready, until the game renders over it, so a tap is never silently lost.
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
      const tmp = resolve(__dirname, ".prerender-play");
      const { build } = await import("vite");
      await build({
        root: __dirname,
        configFile: false,
        logLevel: "warn",
        plugins: [react()],
        build: { ssr: resolve(__dirname, "src/play/prerender.tsx"), outDir: tmp, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "prerender.mjs", format: "esm" } } },
        ssr: { noExternal: [/^@lingxi\//] },
      });
      const g = globalThis as { location?: unknown; __lingxiPrerenderLang?: string };
      const hadLocation = "location" in g;
      if (!hadLocation) g.location = new URL("https://lingxi.invalid/");
      try {
        const screens: Record<string, string> = {};
        for (const lang of ["en", "zh"] as const) {
          g.__lingxiPrerenderLang = lang;
          const mod = (await import(`${pathToFileURL(join(tmp, "prerender.mjs")).href}?lang=${lang}`)) as { render: () => string };
          screens[lang] = mod.render();
        }
        const ready = { en: "Getting the game ready…", zh: "游戏准备中……" };
        const shown = (lang: "en" | "zh") =>
          `<div data-prerender="${lang}" hidden inert aria-busy="true">${screens[lang]}<p class="pre-ready" role="status">${ready[lang]}</p></div>`;
        const pick = `<script>(function(){var s=null;try{s=localStorage.getItem("lingxi.pets.v2")||localStorage.getItem("lingxi.pet.v1")}catch(e){s="?"}if(s!==null)return;var l=null;try{l=localStorage.getItem("lingxi.lang")}catch(e){}if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";var r=document.getElementById("root");r.querySelector(".boot-splash").hidden=true;r.querySelector('[data-prerender="'+l+'"]').hidden=false;if(l==="zh")document.documentElement.lang="zh-CN"})()</script>`;
        const style = `<style>.pre-ready{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);margin:0;padding:6px 14px;border:2px solid #2b2140;border-radius:999px;background:#fffdf8;color:#2b2140;font:600 13px/1.3 system-ui,sans-serif;z-index:10}</style>`;
        const html = readFileSync(page, "utf8");
        const splash = html.match(/<div id="root">(<div class="boot-splash"[\s\S]*?<\/div>)<\/div>/);
        if (!splash) throw new Error("play.html has no splash inside #root to keep beside the hatch screen");
        writeFileSync(page, html.replace(splash[0], `<div id="root">${splash[1]}${shown("en")}${shown("zh")}</div>${pick}${style}`));
      } finally {
        delete g.__lingxiPrerenderLang;
        if (!hadLocation) delete g.location;
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), buildStamp(), namesGuard(), preloadGame(), prerenderLanding(), prerenderPlay(), shipLetters()],
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: { index: resolve(__dirname, "index.html"), play: resolve(__dirname, "play.html"), verify: resolve(__dirname, "verify.html"), agents: resolve(__dirname, "agents.html"), tree: resolve(__dirname, "tree.html"), numbers: resolve(__dirname, "numbers.html"), handheld: resolve(__dirname, "handheld.html") },
    },
  },
  // the end-to-end suite (e2e/) plays a dev server that must not reload a page under a running test when a file is
  // saved; its reload channel stays, since Vite uses it to reload a page after bundling a newly found dependency
  // under the suite it also transforms the game's source as it starts, so a dependency it finds is bundled before any
  // test loads a page (a cold CI machine otherwise found one mid-load, and the page could not load)
  server: { port: 5199, ...(process.env.LINGXI_E2E === "1" ? { watch: null, warmup: { clientFiles: ["./src/**/main.tsx", "./src/**/*.tsx", "!./src/**/*.test.tsx"] } } : {}) },
  // the end-to-end suite gives each run its own dependency cache, so runs never share one and each starts as CI does
  ...(process.env.LINGXI_VITE_CACHE ? { cacheDir: process.env.LINGXI_VITE_CACHE } : {}),
});
