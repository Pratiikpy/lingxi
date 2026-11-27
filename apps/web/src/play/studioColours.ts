/**
 * R40: the design studio's colours by name, in the player's language. A screen reader heard each swatch as a hex code
 * ("#e8604a"); it now hears "Coral" or "珊瑚红". The swatches are a fixed palette, so each carries its own name; a
 * colour of the player's own (the well) is named by the nearest of these and a set of plain colour words, measured in
 * OKLab, where a step of distance looks like the same step of difference whatever the hue.
 */

export interface NamedColour {
  hex: string;
  en: string;
  zh: string;
}

/** The studio's swatches, in the order they are shown, each with its name. */
export const SWATCHES: readonly NamedColour[] = [
  { hex: "#2b2140", en: "Deep plum", zh: "深紫" },
  { hex: "#ffffff", en: "White", zh: "白色" },
  { hex: "#e8604a", en: "Coral", zh: "珊瑚红" },
  { hex: "#ff8fae", en: "Pink", zh: "粉红" },
  { hex: "#ffc83d", en: "Sunny yellow", zh: "明黄" },
  { hex: "#f2cf73", en: "Straw", zh: "麦秆黄" },
  { hex: "#7fcb8e", en: "Mint green", zh: "薄荷绿" },
  { hex: "#4e9e6a", en: "Leaf green", zh: "叶绿" },
  { hex: "#7fb7f0", en: "Sky blue", zh: "天蓝" },
  { hex: "#3f6fb8", en: "Deep blue", zh: "深蓝" },
  { hex: "#b07fe0", en: "Lilac", zh: "丁香紫" },
  { hex: "#7a5236", en: "Brown", zh: "棕色" },
];

/** Plain colour words spread over the rest of the colours, so any colour a player mixes has a near name. */
const WORDS: readonly NamedColour[] = [
  { hex: "#000000", en: "Black", zh: "黑色" },
  { hex: "#404040", en: "Dark grey", zh: "深灰" },
  { hex: "#808080", en: "Grey", zh: "灰色" },
  { hex: "#c8c8c8", en: "Light grey", zh: "浅灰" },
  { hex: "#fff3d0", en: "Cream", zh: "奶油色" },
  { hex: "#e6d5b8", en: "Beige", zh: "米色" },
  { hex: "#e02020", en: "Red", zh: "红色" },
  { hex: "#7a1010", en: "Dark red", zh: "暗红" },
  { hex: "#e83e7a", en: "Rose", zh: "玫红" },
  { hex: "#ffbf99", en: "Peach", zh: "桃色" },
  { hex: "#ff8c1a", en: "Orange", zh: "橙色" },
  { hex: "#d4a017", en: "Gold", zh: "金色" },
  { hex: "#fff13a", en: "Lemon yellow", zh: "柠檬黄" },
  { hex: "#8a8a20", en: "Olive", zh: "橄榄绿" },
  { hex: "#a6e03c", en: "Lime green", zh: "黄绿" },
  { hex: "#22a33a", en: "Green", zh: "绿色" },
  { hex: "#33dd44", en: "Bright green", zh: "亮绿" },
  { hex: "#1e5631", en: "Dark green", zh: "墨绿" },
  { hex: "#1a9e9e", en: "Teal", zh: "蓝绿" },
  { hex: "#40d8e0", en: "Turquoise", zh: "青绿" },
  { hex: "#1f9bff", en: "Azure", zh: "湛蓝" },
  { hex: "#2050e0", en: "Blue", zh: "蓝色" },
  { hex: "#1c2766", en: "Navy", zh: "藏青" },
  { hex: "#7b3fbf", en: "Purple", zh: "紫色" },
  { hex: "#e040c0", en: "Magenta", zh: "品红" },
  { hex: "#c8a070", en: "Tan", zh: "浅棕" },
  { hex: "#3d2516", en: "Dark brown", zh: "深棕" },
];

const ALL = [...SWATCHES, ...WORDS];

/** A colour as OKLab (L, a, b); `hex` is #rrggbb. */
function oklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Closer than this in OKLab, a colour is taken to be the named one itself, not one near it (about 1% of the range). */
const SAME = 0.01;

/**
 * The name of a colour: a swatch's own name, or the nearest named colour and whether it is only near it. A value that
 * is not a colour (never the case from the studio's own inputs) is named as the plain word nearest black.
 */
export function nameOf(hex: string): { colour: NamedColour; exact: boolean } {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "#000000";
  const own = SWATCHES.find((s) => s.hex === h);
  if (own) return { colour: own, exact: true };
  const [l, a, b] = oklab(h);
  let best = ALL[0] as NamedColour;
  let gap = Infinity;
  for (const c of ALL) {
    const [l2, a2, b2] = oklab(c.hex);
    const d = Math.hypot(l - l2, a - a2, b - b2);
    if (d < gap) {
      gap = d;
      best = c;
    }
  }
  return { colour: best, exact: gap < SAME };
}

/** A colour said in a sentence: "coral", "close to sky blue" / "珊瑚红", "接近天蓝". */
export function colourWords(hex: string, lang: "en" | "zh"): string {
  const { colour, exact } = nameOf(hex);
  if (lang === "zh") return exact ? colour.zh : `接近${colour.zh}`;
  const word = colour.en.toLowerCase();
  return exact ? word : `close to ${word}`;
}

/** An ink's name for a screen reader: its number and the colour it holds. */
export function inkLabel(k: number, hex: string, lang: "en" | "zh"): string {
  return lang === "zh" ? `颜色 ${k}：${colourWords(hex, "zh")}` : `Colour ${k}: ${colourWords(hex, "en")}`;
}

/** The well's name: what it does, and the colour it holds now (the chosen ink's). */
export function wellLabel(hex: string, lang: "en" | "zh"): string {
  if (lang === "en") return `Your own colour, now ${colourWords(hex, "en")}`;
  const { exact } = nameOf(hex);
  return exact ? `自己调颜色，现在是${colourWords(hex, "zh")}` : `自己调颜色，现在${colourWords(hex, "zh")}`;
}
