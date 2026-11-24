/**
 * Names hatched from the brain's own code (PRD F14, after TapeFly). The default
 * name is read from a hash of the pet's actual circuit, so a different egg or a
 * different instinct switch gives a different name; `draw` picks another name
 * from the same circuit. The player can always type their own and claim it on
 * chain later.
 */

import { keccak_256 } from "@noble/hashes/sha3";

const EN_START = [
  "Mo",
  "Pi",
  "Ko",
  "Lu",
  "Na",
  "Bo",
  "Ri",
  "Su",
  "Ta",
  "Mi",
  "Po",
  "Ki",
  "Nu",
  "Ra",
  "Fi",
  "Yu",
] as const;
const EN_MID = [
  "chi",
  "po",
  "ri",
  "ko",
  "na",
  "mi",
  "lu",
  "bi",
  "ta",
  "su",
  "ni",
  "pa",
  "do",
  "ke",
  "mu",
  "le",
] as const;
const EN_END = ["", "", "", "n", "s", "ko", "bo", "li"] as const;
const ZH = [
  "团",
  "糖",
  "豆",
  "圆",
  "桃",
  "米",
  "球",
  "布",
  "丁",
  "麻",
  "薯",
  "果",
  "奶",
  "泡",
  "芝",
  "糯",
  "云",
  "星",
  "毛",
  "芽",
  "栗",
  "柚",
  "酥",
  "雪",
  "橙",
  "汤",
  "饼",
  "棉",
  "梨",
  "卷",
  "铃",
  "莓",
] as const;

export interface BrainName {
  en: string;
  zh: string;
  /** the first bytes of the hash the name was read from */
  from: string;
}

/** The name read from a circuit's bytes; `draw` 0 is its first name, 1 its next, and so on. */
export function nameFromBrain(netlist: Uint8Array, draw = 0): BrainName {
  const salt = new Uint8Array(netlist.length + 4);
  salt.set(netlist, 0);
  new DataView(salt.buffer).setUint32(netlist.length, draw >>> 0);
  const d = keccak_256(salt);
  const byte = (i: number) => d[i]!;
  const h = "0x" + Array.from(d.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  const en = EN_START[byte(0) & 15]! + EN_MID[byte(1) & 15]! + EN_END[byte(2) & 7]!;
  const first = ZH[byte(3) & 31]!;
  const second = ZH[byte(4) & 31]!;
  // a doubled character reads as a pet name in Chinese (团团); otherwise two different ones
  const zh = byte(5) & 1 ? first + first : first + (second === first ? ZH[(byte(4) + 1) & 31]! : second);
  return { en, zh, from: h };
}

/* ── names that cannot pass for another (A16) ───────────────────────────── */

/**
 * Invisible or direction-changing code points a name may not carry: those PetLook refuses on chain, and every other
 * code point Unicode 18 marks Default_Ignorable (A16: U+061C, U+17B4..17B5, U+180B..180D, U+180F, U+1BCA0..1BCA3 and
 * U+1D173..1D17A pass PetLook, so the game refuses them itself and shows them where a name carries one).
 */
export function hiddenCodePoint(cp: number): boolean {
  return (
    (cp >= 0x80 && cp <= 0xa0) ||
    cp === 0xad ||
    cp === 0x34f ||
    cp === 0x61c ||
    cp === 0x115f ||
    cp === 0x1160 ||
    (cp >= 0x17b4 && cp <= 0x17b5) ||
    (cp >= 0x180b && cp <= 0x180f) ||
    (cp >= 0x2000 && cp <= 0x206f) ||
    cp === 0x3000 ||
    cp === 0x3164 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    cp === 0xffa0 ||
    (cp >= 0xfff0 && cp <= 0xfffb) ||
    (cp >= 0x1bca0 && cp <= 0x1bca3) ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0xe0000 && cp <= 0xe0fff)
  );
}

/**
 * Code points that draw as nothing, or as a blank that passes for an ordinary space, when a name is shown: Unicode's
 * Default_Ignorable set (18.0), the C1 controls, the spaces other than U+0020, the line and paragraph separators and
 * the interlinear annotation marks. Narrower than `hiddenCodePoint`, which also refuses visible punctuation (… — ‘’)
 * the chain will not take: a name carrying those is shown as it is.
 */
export function invisibleCodePoint(cp: number): boolean {
  return (
    (cp >= 0x80 && cp <= 0xa0) ||
    cp === 0xad ||
    cp === 0x34f ||
    cp === 0x61c ||
    cp === 0x115f ||
    cp === 0x1160 ||
    cp === 0x1680 ||
    (cp >= 0x17b4 && cp <= 0x17b5) ||
    (cp >= 0x180b && cp <= 0x180f) ||
    (cp >= 0x2000 && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202f) ||
    (cp >= 0x205f && cp <= 0x206f) ||
    cp === 0x3000 ||
    cp === 0x3164 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    cp === 0xffa0 ||
    (cp >= 0xfff0 && cp <= 0xfffb) ||
    (cp >= 0x1bca0 && cp <= 0x1bca3) ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0xe0000 && cp <= 0xe0fff)
  );
}

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE = /^[0-9#*]$/;
const TAG_LETTER = /[\u{e0020}-\u{e007e}]/u;
const isSkinTone = (ch: string) => ch.codePointAt(0)! >= 0x1f3fb && ch.codePointAt(0)! <= 0x1f3ff;

/**
 * Whether the invisible character at `i` is part of an emoji, which draws as the emoji and not as nothing: a
 * presentation selector (U+FE0E, U+FE0F) after a pictograph or a keycap's digit, a joiner (U+200D) between two
 * pictographs, or the tag sequence of a black flag (U+1F3F4) that spells out a region. Anywhere else the same
 * character can only hide.
 */
function inEmoji(chars: readonly string[], i: number): boolean {
  const cp = chars[i]!.codePointAt(0)!;
  const before = chars[i - 1];
  if (cp === 0xfe0e || cp === 0xfe0f)
    return before !== undefined && (PICTOGRAPH.test(before) || (KEYCAP_BASE.test(before) && chars[i + 1] === "\u20e3"));
  if (cp === 0x200d) {
    let j = i - 1;
    while (j >= 0 && (chars[j] === "\ufe0f" || isSkinTone(chars[j]!))) j--;
    const after = chars[i + 1];
    return j >= 0 && PICTOGRAPH.test(chars[j]!) && after !== undefined && PICTOGRAPH.test(after);
  }
  if (cp >= 0xe0020 && cp <= 0xe007f) {
    let j = i - 1;
    while (j >= 0 && TAG_LETTER.test(chars[j]!)) j--;
    return j >= 0 && chars[j] === "\u{1f3f4}";
  }
  return false;
}

const shows = (chars: readonly string[], i: number) =>
  !invisibleCodePoint(chars[i]!.codePointAt(0)!) || inEmoji(chars, i);

/** A name with every character that draws as nothing taken out: what a player typed, as it can be seen (a pet's own name). */
export function stripHidden(name: string): string {
  const chars = Array.from(name);
  return chars.filter((_, i) => shows(chars, i)).join("");
}

/**
 * A name as it may be shown: each character that would draw as nothing replaced by U+FFFD, so a name that carries one
 * (PetLook lets a few through, and the live room, cards and papers come from other players) can never pass for
 * another; `hidden` counts them.
 */
export function revealHidden(name: string): { text: string; hidden: number } {
  const chars = Array.from(name);
  let hidden = 0;
  const text = chars.map((ch, i) => (shows(chars, i) ? ch : (hidden++, "\ufffd"))).join("");
  return { text, hidden };
}

/** The most of a name ever looked at: a name is cut far shorter, and a hostile one cannot make the work grow. */
const NAME_READ_MAX = 256;

/** The longest a pet's name may be, in visible characters (P5). */
export const NAME_MAX = 12;

// one visible character is one grapheme cluster: an emoji with its skin tone, a family joined by ZWJ, a flag, a letter
// with its accents. Every browser the game supports and Node have Intl.Segmenter; code points are the fallback
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** The visible characters of `text`, in order (P5). */
export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (g) => g.segment) : Array.from(text);
}

/** How many characters `text` shows (P5). */
export const visibleLength = (text: string): number => graphemes(text).length;

/** `text` cut to its first `max` visible characters, never inside one (P5). */
export function takeVisible(text: string, max: number): string {
  const g = graphemes(text);
  return g.length <= max ? text : g.slice(0, max).join("");
}

/**
 * Another player's pet name as this game shows it, wherever it arrives from (the live room, a card, a family's papers,
 * a duel): control characters and angle brackets dropped, every hidden code point shown as U+FFFD, trimmed, and cut to
 * `max` UTF-16 units without splitting a character.
 */
export function shownName(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const text = revealHidden(raw.slice(0, NAME_READ_MAX).replace(/[\u0000-\u001f\u007f<>]/g, "")).text.trim();
  // P5: measured and cut in visible characters, never inside an emoji, a flag or an accented letter; and held to
  // UNITS_PER_CHAR code units a character, so one "character" built of a thousand invisible tags stays short
  return capUnits(takeVisible(text, max), max * UNITS_PER_CHAR).trimEnd();
}

/** Code units a visible character may take in a name: a family of four with skin tones fits, a hostile run does not. */
const UNITS_PER_CHAR = 8;

/** `text` cut to at most `units` code units, on a character's edge; a single character longer than that, on a code point's. */
function capUnits(text: string, units: number): string {
  if (text.length <= units) return text;
  let out = "";
  for (const g of graphemes(text)) {
    if (out.length + g.length <= units) {
      out += g;
      continue;
    }
    if (!out) for (const cp of Array.from(g)) if (out.length + cp.length <= units) out += cp;
    break;
  }
  return out;
}
