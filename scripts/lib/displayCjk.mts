/**
 * R29: the Chinese page titles drawn in the pixel face, as the English ones are in Pixelify Sans. Pixelify has no Chinese,
 * so these titles take a second face, Ark Pixel Font 12px (OFL 1.1), cut to exactly the characters below
 * (scripts/display-cjk-font.mts builds the file and its @font-face). Each entry is a title as its page writes it: a title
 * that changes, or a new one, is added here and the font rebuilt, or the test fails (scripts/displayCjk.test.mts), so no
 * title is ever drawn half in one face and half in another.
 */
export const DISPLAY_CJK_TITLES: ReadonlyArray<{ page: string; file: string; text: string }> = [
  { page: "the landing's headline", file: "apps/web/src/landing/copy.ts", text: "养一个小小的心智。" },
  { page: "verify.html", file: "apps/web/src/verify/verifyText.ts", text: "验证一只灵犀宠物" },
  { page: "agents.html", file: "apps/web/src/agents/AgentsApp.tsx", text: "给 AI 智能体" },
  { page: "numbers.html", file: "apps/web/src/numbers/NumbersApp.tsx", text: "链上数字" },
  { page: "tree.html", file: "apps/web/src/tree/TreeApp.tsx", text: "生命之树" },
  { page: "handheld.html", file: "apps/web/src/handheld/HandheldApp.tsx", text: "灵犀掌机" },
  { page: "privacy.html", file: "apps/web/src/info/InfoApp.tsx", text: "隐私" },
  { page: "terms.html", file: "apps/web/src/info/InfoApp.tsx", text: "条款" },
  { page: "circuits.html", file: "apps/web/circuits.html", text: "灵犀电路" },
  { page: "404.html", file: "apps/web/404.html", text: "这个页面不在这里" },
];

const codePoint = (c: string): number => c.codePointAt(0) ?? 0;

/** The characters the pixel face is cut to: every character of the titles that Pixelify Sans does not draw. */
export function displayCjkChars(titles = DISPLAY_CJK_TITLES): string[] {
  return [...new Set(titles.flatMap((t) => [...t.text]).filter((c) => codePoint(c) > 0xff))].sort(
    (a, b) => codePoint(a) - codePoint(b),
  );
}

/** A CSS unicode-range naming exactly these characters. */
export function unicodeRange(chars: readonly string[]): string {
  return chars.map((c) => `U+${codePoint(c).toString(16).toUpperCase()}`).join(", ");
}
