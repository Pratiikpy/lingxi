/**
 * The quest line (plan 4.2, 36-QUEST-LINE.md): 80 story quests in 12 arcs and 15 dailies, with the checks that
 * keep the sheet honest. Every check here runs in the tests and before the web build (scripts/check-sheets.ts).
 */

import { CHARACTERS } from "../characters";
import { LANE } from "../conditions";
import { DECOR_BY_ID } from "../decor";
import type { QuestDef, Reward } from "../story";
import { PIECES } from "../wardrobe";
import { ITEM, TRAVEL_RECIPES } from "../world";
import { ARC_1 } from "./arc01-first-days";
import { ARC_2_TO_5 } from "./arc02-05";
import { ARC_6_TO_10 } from "./arc06-10";
import { ARC_11_12 } from "./arc11-12";
import { DAILIES, WEEKLY_GIFT } from "./dailies";

export { ARC_1, ONBOARDING } from "./arc01-first-days";
export { DAILIES, WEEKLY_GIFT };

export const STORY: readonly QuestDef[] = [...ARC_1, ...ARC_2_TO_5, ...ARC_6_TO_10, ...ARC_11_12];
export const QUESTLINE: readonly QuestDef[] = [...STORY, ...DAILIES];
export const QUEST_BY_ID: Readonly<Record<string, QuestDef>> = Object.fromEntries(QUESTLINE.map((q) => [q.id, q]));

/** The pet's faces (@lingxi/art faces.ts); the web tests check this list against the drawings. */
export const PET_FACES = ["neutral", "happy", "sparkly", "sulk", "sleepy", "yawn", "shy", "proud", "startled", "munch", "munchShut", "sneeze", "dizzy", "sad", "asleep", "love"] as const;
const PET_FACE_SET = new Set<string>(PET_FACES);
/** Each resident's portraits, as their own talk lines already use them. */
const PORTRAITS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CHARACTERS.map((c) => [c.id, new Set([...c.greeting, ...c.topics.flatMap((t) => t.lines), c.bye].map((l) => l.face))] as const),
);
const LANE_SET = new Set<string>(LANE);

/** The longest line that fits the talk bubble on a phone (measured in the game: two lines of the bubble). */
export const LINE_MAX = { en: 140, zh: 70 } as const;

function rewardProblem(r: Reward): string | null {
  switch (r.kind) {
    case "coins":
      return Number.isInteger(r.n) && r.n > 0 ? null : "coins must be a whole number above 0";
    case "item":
      return ITEM[r.item] && Number.isInteger(r.n) && r.n > 0 ? null : `no item ${r.item}`;
    case "trust":
      return PORTRAITS.has(r.who) && r.n > 0 ? null : `no resident ${r.who} to trust`;
    case "flag":
      return /^[a-z0-9-]{1,32}$/.test(r.name) ? null : `flag ${r.name} must be a lower-case word`;
    case "piece":
      return PIECES[r.id] ? null : `no piece ${r.id}`;
    case "decor":
      return DECOR_BY_ID[r.id] ? null : `no decor ${r.id}`;
    case "recipe":
      return TRAVEL_RECIPES.some((t) => t.index === r.index) ? null : `no travel recipe ${r.index}`;
  }
}

/** Problems with the quest line beyond its conditions (those are checked by the condition engine's sheet check). */
export function questLineErrors(defs: readonly QuestDef[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const q of defs) {
    const at = `quest ${q.id}`;
    if (ids.has(q.id)) out.push(`${at}: the id is used twice`);
    ids.add(q.id);
    if (!q.title.en || !q.title.zh) out.push(`${at}: needs a title in both languages`);
    if (q.kind === "daily" && !q.group) out.push(`${at}: a daily needs its group`);
    if (q.kind === "story" && !(q.arc && q.arc >= 1 && q.arc <= 12)) out.push(`${at}: a story quest needs its arc (1 to 12)`);
    // the giver: the pet, a resident, or a Builders' Lane resident
    const lane = q.giver.startsWith("lane:") ? q.giver.slice(5) : null;
    if (q.giver !== "pet" && !PORTRAITS.has(q.giver) && !(lane && LANE_SET.has(lane))) out.push(`${at}: no giver ${q.giver}`);
    // every line in both languages, short enough for the bubble, with a face its speaker has
    for (const [part, lines] of [["intro", q.intro], ["outro", q.outro]] as const) {
      if (!lines.length) out.push(`${at}: needs an ${part}`);
      lines.forEach((l, i) => {
        if (!l.en || !l.zh) out.push(`${at} ${part} ${i + 1}: needs both languages`);
        if (l.en.length > LINE_MAX.en) out.push(`${at} ${part} ${i + 1}: English is ${l.en.length} characters (at most ${LINE_MAX.en})`);
        if ([...l.zh].length > LINE_MAX.zh) out.push(`${at} ${part} ${i + 1}: Chinese is ${[...l.zh].length} characters (at most ${LINE_MAX.zh})`);
        if (q.giver === "pet" && (!l.face || !PET_FACE_SET.has(l.face))) out.push(`${at} ${part} ${i + 1}: the pet has no face ${l.face}`);
        if (PORTRAITS.has(q.giver) && (!l.face || !PORTRAITS.get(q.giver)!.has(l.face))) out.push(`${at} ${part} ${i + 1}: ${q.giver} has no portrait ${l.face}`);
        if (lane && l.face) out.push(`${at} ${part} ${i + 1}: Builders' Lane residents speak without a portrait`);
      });
    }
    q.objectives.forEach((o, i) => {
      if (!o.text.en || !o.text.zh) out.push(`${at} objective ${i + 1}: needs its words in both languages`);
    });
    // requirements are checked once, when the quest is offered: counting "from now" means nothing there
    q.requires.forEach((c, i) => {
      if (c.logic.startsWith("INC")) out.push(`${at} requirement ${i + 1}: a requirement cannot count from now`);
    });
    for (const r of q.rewards) {
      const p = rewardProblem(r);
      if (p) out.push(`${at}: ${p}`);
    }
    if (q.kind === "story" && !q.rewards.length) out.push(`${at}: every story quest gives something`);
  }
  return out;
}
