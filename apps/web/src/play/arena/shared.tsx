/**
 * What the arena's parts share (P7: out of Arena.tsx): the language, the moves' names, the colours, a pet's picture,
 * why a coach's note says what it says, and the few constants the panels read.
 */
/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { type OverlayPixel, type Palette, type PixelCanvas, boundingBox, type Outfit } from "@lingxi/art";
import { type CoachNote, type Move, type Partner, ruleSource } from "@lingxi/game";
import { LILAC, MINT, PEACH } from "@lingxi/art";

import { deployment } from "../../game/chain";
import { MOVE_WORDS } from "../ruleText";
import { PALETTE_OF } from "../../scene/palette";
import { Sprite } from "../Sprite";
import "../arena.css";
import "../rewind.css";

/** A pet in a replay, or with nothing on: one shared empty outfit, so its drawing is not redone each round. */
export const NO_OUTFIT: Outfit = {};

export type Lang = "en" | "zh";

export const MOVE_NAMES: Record<Move, [string, string]> = MOVE_WORDS;

/** A pet sprite cropped to what is drawn, so small pets are not lost in empty canvas. */
/** A partner's own colouring, when it has one (B7). */
export const COLOURS = { lilac: LILAC, mint: MINT, peach: PEACH } as const;

export const coloursOf = (p: Partner): Palette | undefined => (p.colours ? COLOURS[p.colours] : undefined);

export function PetArt({
  canvas,
  line,
  palette,
  scale,
  label,
  overlay,
}: {
  canvas: PixelCanvas;
  line: keyof typeof PALETTE_OF;
  palette?: Palette;
  scale: number;
  label?: string;
  overlay?: readonly OverlayPixel[];
}) {
  const b = boundingBox(canvas);
  const crop = {
    x: Math.max(0, b.x - 1),
    y: Math.max(0, b.y - 1),
    w: Math.min(canvas.w - Math.max(0, b.x - 1), b.w + 2),
    h: Math.min(canvas.h - Math.max(0, b.y - 1), b.h + 2),
  };
  return (
    <Sprite
      canvas={canvas}
      palette={palette ?? PALETTE_OF[line]}
      scale={scale}
      crop={crop}
      label={label}
      overlay={overlay}
    />
  );
}

export function why(key: CoachNote["key"], name: string, other: string, lang: Lang): string {
  const en: Record<CoachNote["key"], string> = {
    tooPassive: `${other} kept leaving openings, and ${name} didn't take them.`,
    noDefence: `${name} took big hits without guarding.`,
    ranOut: `${name} ran out of energy and had to rest at the worst moments.`,
    noHealing: `${name} stayed hurt instead of eating to recover.`,
    outmatched: `${other} was simply stronger this time.`,
    wellDone: `${name} fought well.`,
  };
  const zh: Record<CoachNote["key"], string> = {
    tooPassive: `${other}好几次露出破绽，${name}都没抓住。`,
    noDefence: `${name}挨了重击却没有防守。`,
    ranOut: `${name}没力气了，只能在最糟的时候休息。`,
    noHealing: `${name}受伤了也没吃东西恢复。`,
    outmatched: `这次${other}就是更强。`,
    wellDone: `${name}打得很好。`,
  };
  return (lang === "zh" ? zh : en)[key];
}

export const STAGE_INDEX: Record<string, number> = { baby: 0, child: 1, teen: 2, adult: 3 };

export const LINE_ZH: Record<string, string> = { gentle: "温柔", bold: "勇敢", curious: "好奇" };

export const DEFAULT_PROCESSOR = (deployment?.processor as string | undefined) ?? "";

export const READ_ERR: Record<string, { en: string; zh: string }> = {
  notProcessor: {
    en: "That address isn't a TapeOut processor registered on X Layer.",
    zh: "这个地址不是 X Layer 上注册的 TapeOut 处理器。",
  },
  noCircuit: { en: "No circuit with that number on that processor.", zh: "这个处理器上没有这个编号的电路。" },
  tooDeep: { en: "That circuit nests other circuits too deeply to carry.", zh: "这个电路一层套一层，太深了，带不动。" },
  tooBig: { en: "That circuit is too big for a pet to carry on a phone.", zh: "这个电路太大了，宠物在手机上带不动。" },
  illFormed: { en: "That circuit's bytes don't read as a TapeOut netlist.", zh: "这个电路的字节读不成 TapeOut 网表。" },
  pins: {
    en: "Its pins don't fit a fight: it needs TapeFly's 12 in and 3 out, or a pet's 16 in and 8 out.",
    zh: "它的引脚接不上切磋：需要 TapeFly 的 12 进 3 出，或宠物的 16 进 8 出。",
  },
  offline: { en: "X Layer can't be reached right now; try again in a moment.", zh: "暂时连不上 X Layer，请稍后再试。" },
};

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const RULE_SOURCE: Record<ReturnType<typeof ruleSource>, { en: string; zh: string }> = {
  taught: { en: "from something you taught it", zh: "来自你教它的" },
  instinct: { en: "from an instinct it hatched with", zh: "来自它天生的本能" },
  born: { en: "from how its egg line is born", zh: "来自它这一系生来就会的" },
  default: { en: "nothing matched, so its default move", zh: "没有条件符合，按默认出招" },
  outside: { en: "from the instinct circuit it was taught", zh: "来自它学会的本能电路" },
};

export const OPEN: Record<"rest" | "snack" | "charm", { en: string; zh: string }> = {
  rest: { en: "resting", zh: "在休息" },
  snack: { en: "snacking", zh: "在吃零食" },
  charm: { en: "charming", zh: "在卖萌" },
};
