/**
 * The share card of each page (P6): its title in both languages and the line under it, for the card image
 * (scripts/share-cards.mts) and the tags in the page's head that point at it.
 */

/** Where the cards are served from: a chat reads a card's image by its full address. */
export const SITE = "https://lingxi.knole.me";

export interface Card {
  page: string;
  en: string;
  zh: string;
  line: string;
  pet: "gentle" | "bold" | "curious";
  description: string;
}

export const CARDS: readonly Card[] = [
  { page: "index.html", en: "Raise a little mind", zh: "养一个小小的心智", line: "A pet whose brain is a real circuit of NAND gates, taped out on X Layer.", pet: "gentle", description: "Raise a little mind: a pet whose brain is a real circuit of NAND gates, taped out on X Layer once you keep it there." },
  { page: "play.html", en: "Hatch your pet", zh: "孵出你的宠物", line: "Pick an egg, name it, and teach it in your own words.", pet: "bold", description: "Hatch a Lingxi pet: pick an egg, name it, and raise a mind that is a real circuit of NAND gates." },
  { page: "verify.html", en: "Verify a pet", zh: "验证一只宠物", line: "Check its brain and its memory against X Layer, from your own browser.", pet: "curious", description: "Check a Lingxi pet against X Layer from your own browser: its brain, its saved memory and its published diary." },
  { page: "numbers.html", en: "Live numbers", zh: "链上数字", line: "Pets, days saved, outfit sales and BEM burned, read from the chain.", pet: "gentle", description: "What Lingxi has done on X Layer, read from the chain: pets, days saved, outfit sales and BEM burned." },
  { page: "tree.html", en: "The tree of life", zh: "生命之树", line: "Every pet hatched or bred on X Layer, as one family tree.", pet: "bold", description: "Every Lingxi pet ever hatched or bred on X Layer, as one family tree read from the chain." },
  { page: "agents.html", en: "For AI agents", zh: "给 AI 智能体", line: "An open API: read any pet's circuit brain, spar it, raise one.", pet: "curious", description: "An open API for AI agents: read any Lingxi pet kept on X Layer and its circuit brain, spar any brain, raise a pet and enter the weekly season." },
  { page: "handheld.html", en: "The handheld", zh: "掌上灵犀", line: "Your pet's circuit, running on the handheld's own firmware.", pet: "gentle", description: "Take your Lingxi pet along: the handheld's own firmware in your browser, running your pet's circuit." },
  { page: "circuits.html", en: "Lingxi circuits", zh: "灵犀电路", line: "Every circuit on X Layer, its pins and its test vectors.", pet: "curious", description: "Every Lingxi circuit on X Layer, its pins, what each bit means, and test vectors. Run any of them on X Layer from this page." },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The tags a page carries for its card, between two marks so they can be written again. */
export function cardTags(c: Card): string {
  const image = `${SITE}/cards/${c.page.replace(/\.html$/, "")}.png`;
  const url = `${SITE}/${c.page === "index.html" ? "" : c.page}`;
  const title = `${c.en} · Lingxi 灵犀`;
  return [
    "<!-- share card -->",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Lingxi · 灵犀" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(c.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(`${c.en} · ${c.zh}`)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:locale:alternate" content="zh_CN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(c.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    "<!-- /share card -->",
  ].join("\n    ");
}
