/**
 * R63: the pixel face (Pixelify Sans, --display) only where it can be read. Its letters are drawn on a grid of tenths of
 * the font size, and a C differs from an O, a G from a B, by one square of that grid: below 20px that square is under
 * two screen pixels and blurs shut on a 1x screen ("BRAIN OIROUIT", "bisouit.mind", "Bift giver"), and at 13px it still
 * misreads on a phone's 2x screen. So the pixel face is for text of 20px and above; a label below that is set in the
 * label face (--label, tokens.css).
 *
 * Every stylesheet rule that sets the pixel face must set a size of its own whose smallest value is 20px or more. The
 * game screens' rules below are still to be changed (apps/web/src/play, where another change is under way): each is
 * listed until it is, and the list may only shrink.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const src = join(root, "apps", "web", "src");
const SMALLEST_PX = 20;

/** The game screens' rules still to move to the label face: `file | selector`. */
const STILL_TO_CHANGE = new Set([
  "play/arena.css | .sp-who b",
  "play/arena.css | .sp-record",
  "play/arena.css | .sp-head",
  "play/arena.css | .sp-fighter .sp-bar b",
  "play/arena.css | .sp-move",
  "play/arena.css | .sp-result .sp-coins",
  "play/arenarun.css | .ar-vs",
  "play/badges.css | .badge b",
  "play/badges.css | .badge-toast b",
  "play/decor.css | .decor-head b",
  "play/family.css | .fam-parent b",
  "play/family.css | .fam-pet b",
  "play/family.css | .pet-count",
  "play/games.css | .game-card b",
  "play/games.css | .game-hud",
  "play/gift.css | .gift-item i",
  "play/handheld.css | .handheld-stepper output",
  "play/hatch.css | .name-row label",
  "play/hatch.css | .hatch-perk-h",
  "play/hatch.css | .instincts legend",
  "play/play.css | .think em",
  "play/play.css | .op",
  "play/play.css | .cardbar",
  "play/play.css | .rows dt",
  "play/play.css | .chainpanel .label",
  "play/play.css | .social .here",
  "play/play.css | .here-list b",
  "play/play.css | .visitor-card b",
  "play/play.css | .half-head",
  "play/play.css | .lv",
  "play/play.css | .bh-lamp i",
  "play/quests.css | .map-quest",
  "play/quests.css | .tq-mark",
  "play/redpacket.css | .rp-envelope",
  "play/rewind.css | .rw-clock",
  "play/talk.css | .talk-name",
  "play/teach.css | .teach .label, .builder .label",
  "play/teach.css | .level-n",
  "play/world.css | .tile.fog",
  "play/world.css | .bag .label",
]);

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(d, e.name))) : [join(d, e.name)],
  );

/** A size's smallest value in px: a px or rem length, or a clamp()'s floor; null for a size the rule does not set. */
export function smallestPx(size: string | undefined): number | null {
  if (!size) return null;
  const clamp = /^clamp\(\s*([\d.]+)(px|rem)/.exec(size.trim());
  const one = clamp ?? /^([\d.]+)(px|rem)$/.exec(size.trim());
  if (!one) return null;
  return Number(one[1]) * (one[2] === "rem" ? 16 : 1);
}

/** Every rule setting the pixel face, with the size it sets (from font-size, or the font shorthand). */
export function pixelRules(css: string): Array<{ selector: string; size: number | null }> {
  const out: Array<{ selector: string; size: number | null }> = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2] ?? "";
    const family = /(?:^|;)\s*font-family:\s*([^;]+)/.exec(body)?.[1];
    const font = /(?:^|;)\s*font:\s*([^;]+)/.exec(body)?.[1];
    if (!(family ?? font ?? "").includes("var(--display)")) continue;
    const fromShorthand = font
      ? /([\d.]+(?:px|rem)|clamp\([^)]*\))(?:\/[\d.]+\w*)?\s+var\(--display\)/.exec(font)?.[1]
      : undefined;
    const size = /(?:^|;)\s*font-size:\s*([^;]+)/.exec(body)?.[1] ?? fromShorthand;
    out.push({ selector: (m[1] ?? "").trim().replace(/\s+/g, " "), size: smallestPx(size) });
  }
  return out;
}

describe("the pixel face only where it can be read (R63)", () => {
  const found = walk(src)
    .filter((f) => f.endsWith(".css"))
    .flatMap((f) =>
      pixelRules(readFileSync(f, "utf8")).map((r) => ({
        key: `${relative(src, f).split("\\").join("/")} | ${r.selector}`,
        size: r.size,
      })),
    );
  const small = found.filter((r) => r.size === null || r.size < SMALLEST_PX);

  it("reads a rule's size from font-size, the font shorthand, rem and clamp()", () => {
    const rules = pixelRules(
      ".a{font-family:var(--display);font-size:13px}.b{font:800 1.8rem/1.1 var(--display)}" +
        ".c{font-family:var(--display);font-size:clamp(32px,6vw,52px)}.d{font-family:var(--display)}.e{color:red}",
    );
    expect(rules).toEqual([
      { selector: ".a", size: 13 },
      { selector: ".b", size: 28.8 },
      { selector: ".c", size: 32 },
      { selector: ".d", size: null },
    ]);
  });

  it("no rule sets the pixel face below 20px, or without a size of its own, but the game screens' listed ones", () => {
    expect(small.filter((r) => !STILL_TO_CHANGE.has(r.key)).map((r) => `${r.key} (${r.size ?? "no size"})`)).toEqual(
      [],
    );
  });

  it("the list of rules still to change only shrinks: a rule changed comes off it", () => {
    const still = new Set(small.map((r) => r.key));
    expect([...STILL_TO_CHANGE].filter((k) => !still.has(k))).toEqual([]);
  });
});
