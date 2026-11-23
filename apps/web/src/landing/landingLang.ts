/**
 * The landing's language: the reader's (i18n's store), or, while the page is prerendered at build time, the language
 * being rendered (P3). On the server a zustand store is read through its initial state, so the build's render says which
 * language it wants through this context instead.
 */
import { createContext, useContext } from "react";
import { type Lang, useLang } from "../i18n";

export const PrerenderLang = createContext<Lang | null>(null);

export function useLandingLang(): { lang: Lang; toggle: () => void } {
  const forced = useContext(PrerenderLang);
  const store = useLang();
  return forced ? { lang: forced, toggle: store.toggle } : store;
}
