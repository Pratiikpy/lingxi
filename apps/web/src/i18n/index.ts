import { create } from "zustand";
import { type Key, en, zh } from "./strings";
import { telegramLang } from "../game/telegram";

export type Lang = "en" | "zh";
const KEY = "lingxi.lang";

function initialLang(): Lang {
  // a page rendered at build time names its language (P3: the prerendered hatch screen); a browser never sets this
  const prerender = (globalThis as { __lingxiPrerenderLang?: unknown }).__lingxiPrerenderLang;
  if (prerender === "en" || prerender === "zh") return prerender;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // storage blocked: fall through to the browser's language
  }
  const tg = telegramLang();
  if (tg) return tg;
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

interface LangState {
  lang: Lang;
  toggle: () => void;
}

export const useLang = create<LangState>((set, get) => ({
  lang: initialLang(),
  toggle: () => {
    const lang: Lang = get().lang === "en" ? "zh" : "en";
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // the choice still applies for this visit
    }
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    set({ lang });
  },
}));

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const raw = (lang === "zh" ? zh : en)[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function useT(): (key: Key, vars?: Vars) => string {
  const lang = useLang((s) => s.lang);
  return (key, vars) => translate(lang, key, vars);
}

export type { Key };
