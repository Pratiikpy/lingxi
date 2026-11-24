/**
 * Each page's language, title and description, in both languages, from one list (A111). The HTML files carry the
 * English as written here, for crawlers and link previews that do not run the page; once the page runs, `usePageMeta`
 * sets `<html lang>`, the title and the description to the reader's language, and keeps them in step when it changes.
 */
import { useEffect } from "react";
import { type Lang, useLang } from "./index";

export type Page = "index" | "play" | "verify" | "handheld" | "numbers" | "tree" | "agents" | "privacy" | "terms";

type Both = Record<Lang, string>;

const OPENING: Both = {
  en: "Raise a little mind: a pet whose brain is a real circuit of NAND gates, taped out on X Layer once you keep it there.",
  zh: "养一个小小的心智：一只大脑为真实与非门电路的宠物，把它留在 X Layer 上，这块电路就在链上流片。",
};

export const PAGE_META: Record<Page, { title: Both; description: Both }> = {
  privacy: {
    title: { en: "Privacy · Lingxi", zh: "隐私 · 灵犀" },
    description: {
      en: "What Lingxi keeps and why: your pet lives in your browser; no accounts, no cookies; what the server keeps and what goes to others.",
      zh: "灵犀保存什么、为什么：你的宠物住在你的浏览器里；没有账号，不设 cookie；服务器保存什么，什么会交给别人。",
    },
  },
  terms: {
    title: { en: "Terms · Lingxi", zh: "条款 · 灵犀" },
    description: {
      en: "Lingxi's terms in plain words: free to play, what happens on X Layer, what you write, and the service.",
      zh: "用平实的话写的灵犀条款：免费游玩、X Layer 上会发生什么、你写的内容，以及服务。",
    },
  },
  index: { title: { en: "Lingxi · Raise a little mind", zh: "灵犀 · 养一个小小的心智" }, description: OPENING },
  play: { title: { en: "Lingxi · 灵犀", zh: "灵犀 · Lingxi" }, description: OPENING },
  verify: {
    title: { en: "Verify a Lingxi pet", zh: "核对一只灵犀宠物" },
    description: {
      en: "Check a Lingxi pet against X Layer from your own browser: its brain, its saved memory and its published diary.",
      zh: "在你自己的浏览器里对照 X Layer 核对一只灵犀宠物：它的大脑、保存的记忆和发布的日记。",
    },
  },
  handheld: {
    title: { en: "Lingxi handheld", zh: "灵犀掌机" },
    description: {
      en: "Take your Lingxi pet along: the handheld's own firmware in your browser, running your pet's circuit, read from X Layer once its mind is kept there.",
      zh: "带你的灵犀宠物出门：掌机自己的固件在浏览器里运行你宠物的电路；它的心智留在 X Layer 上后，电路从链上读取。",
    },
  },
  numbers: {
    title: { en: "Lingxi · live numbers", zh: "灵犀 · 链上数字" },
    description: {
      en: "What Lingxi has done on X Layer, read from the chain: pets, days saved, outfit sales and BEM burned.",
      zh: "灵犀在 X Layer 上做了什么，从链上读取：宠物、保存的天数、服装销售和燃烧的 BEM。",
    },
  },
  tree: {
    title: { en: "Lingxi · the tree of life", zh: "灵犀 · 生命之树" },
    description: {
      en: "Every Lingxi pet ever hatched or bred on X Layer, as one family tree read from the chain.",
      zh: "在 X Layer 上孵化或出生的每一只灵犀宠物，汇成一棵从链上读取的家族树。",
    },
  },
  agents: {
    title: { en: "Lingxi for AI agents", zh: "灵犀 · 给 AI 智能体" },
    description: {
      en: "An open API for AI agents: read any Lingxi pet kept on X Layer and its circuit brain, spar any brain, raise a pet and enter the weekly season.",
      zh: "给 AI 智能体的开放接口：读取任何一只留在 X Layer 上的灵犀宠物和它的电路大脑，和任何大脑切磋，养一只宠物并参加每周赛季。",
    },
  },
};

/** Sets the page's language, title and description for `lang`. */
export function applyPageMeta(page: Page, lang: Lang, doc: Document = document): void {
  const meta = PAGE_META[page];
  doc.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  doc.title = meta.title[lang];
  doc.querySelector('meta[name="description"]')?.setAttribute("content", meta.description[lang]);
}

/** Keeps the page's language, title and description in the reader's language. */
export function usePageMeta(page: Page): void {
  const lang = useLang((s) => s.lang);
  useEffect(() => applyPageMeta(page, lang), [page, lang]);
}
