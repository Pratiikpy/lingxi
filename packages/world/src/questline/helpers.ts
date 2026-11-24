/** Shorthands for writing the quest sheets (plan 4.2) so each quest reads like the table it came from. */

import type { Condition, ConditionType } from "../conditions";
import type { Objective, QuestDef, QuestLine, Reward, Text } from "../story";

export const T = (en: string, zh: string): Text => ({ en, zh });
/** A line of dialogue: the speaker's face (a resident's portrait or the pet's expression) and the words. */
export const say = (face: string | undefined, en: string, zh: string): QuestLine =>
  face ? { face, en, zh } : { en, zh };

/** Counts from the moment the quest is accepted. */
export const from = (type: ConditionType, index: number | string | undefined, value: number): Condition => ({
  type,
  logic: "INC_MIN",
  ...(index !== undefined ? { index } : {}),
  value,
});
/** Counts over the player's whole life (milestones). */
export const ever = (type: ConditionType, index: number | string | undefined, value: number): Condition => ({
  type,
  logic: "CURR_MIN",
  ...(index !== undefined ? { index } : {}),
  value,
});
/** A yes/no fact. */
export const is = (type: ConditionType, index?: number | string, value?: number): Condition => ({
  type,
  logic: "BOOL_IS",
  ...(index !== undefined ? { index } : {}),
  ...(value !== undefined ? { value } : {}),
});
export const done = (quest: string): Condition => is("QUEST", quest);
/** Passes when any one passes: a solo path beside one that needs another player. */
export const anyOf = (...of: Condition[]): Condition => ({ type: "ANY", logic: "BOOL_IS", of });
export const obj = (cond: Condition, en: string, zh: string): Objective => ({ cond, text: { en, zh } });

export const coins = (n: number): Reward => ({ kind: "coins", n });
export const item = (id: number, n = 1): Reward => ({ kind: "item", item: id, n });
export const trust = (who: string, n: number): Reward => ({ kind: "trust", who, n });
export const flag = (name: string): Reward => ({ kind: "flag", name });
export const piece = (id: string): Reward => ({ kind: "piece", id });
export const decor = (id: string): Reward => ({ kind: "decor", id });
export const recipe = (index: number): Reward => ({ kind: "recipe", index });

type StoryInput = Omit<QuestDef, "kind" | "requires" | "rewards"> & {
  requires?: readonly Condition[];
  rewards?: readonly Reward[];
};
export const story = (q: StoryInput): QuestDef => ({ requires: [], rewards: [], ...q, kind: "story" });
export const daily = (q: Omit<QuestDef, "kind" | "requires"> & { requires?: readonly Condition[] }): QuestDef => ({
  requires: [],
  ...q,
  kind: "daily",
});
