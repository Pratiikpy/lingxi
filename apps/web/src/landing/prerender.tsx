/**
 * P3: the landing rendered to HTML at build time, once in each language, so its headline and copy paint before any of
 * the page's script has arrived on a slow phone (vite.config.ts `prerenderLanding` writes both into index.html; a
 * small inline script shows the reader's one; React then renders the same page over it).
 */
import { renderToString } from "react-dom/server";
import type { Lang } from "../i18n";
import { LandingApp } from "./LandingApp";
import { PrerenderLang } from "./landingLang";

export function render(lang: Lang): string {
  return renderToString(
    <PrerenderLang.Provider value={lang}>
      <LandingApp />
    </PrerenderLang.Provider>,
  );
}
