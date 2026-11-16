/**
 * Every sheet of conditions the game ships (quests, dailies, goals, gates), in one list so a single check covers
 * them all. A sheet is validated before the web build (scripts/check-sheets.ts) and in the tests, so a typo in an
 * item, room, resident or quest fails loudly with the row named instead of shipping a quest that cannot be done.
 */

import { type Condition, type SheetRefs, assertSheet } from "./conditions";
import { DAILIES, GOALS, QUESTLINE, STORY, goalErrors, questLineErrors } from "./questline";

export interface Sheet {
  name: string;
  rows: ReadonlyArray<{ id: string; conditions: readonly Condition[] }>;
  refs?: SheetRefs;
}

const QUEST_IDS = new Set(QUESTLINE.map((q) => q.id));
const GOAL_IDS = new Set(GOALS.map((g) => g.id));
const rowsOf = (defs: typeof STORY) => defs.map((q) => ({ id: q.id, conditions: [...q.requires, ...q.objectives.map((o) => o.cond)] }));

/** The sheets in the game: story quests and dailies (plan 4.2). Community goals count chain events, not conditions; their own check is goalErrors. */
export const SHEETS: Sheet[] = [
  { name: "story", rows: rowsOf(STORY), refs: { quests: QUEST_IDS, goals: GOAL_IDS } },
  { name: "daily", rows: rowsOf(DAILIES), refs: { quests: QUEST_IDS, goals: GOAL_IDS } },
];

/** Check every sheet; one error lists every bad row of every sheet. */
export function checkSheets(sheets: readonly Sheet[]): void {
  const problems: string[] = [];
  for (const s of sheets) {
    try {
      assertSheet(s.name, s.rows, s.refs);
    } catch (e) {
      problems.push(String((e as Error).message).replace(/^bad sheet\n/, ""));
    }
  }
  if (problems.length) throw new Error(`bad sheet\n${problems.join("\n")}`);
}

/** Everything the build checks: the condition sheets, then the quest line's own rules. */
export function checkGame(): void {
  checkSheets(SHEETS);
  const problems = [...questLineErrors(QUESTLINE), ...goalErrors(GOALS)];
  if (problems.length) throw new Error(`bad quest line\n${problems.join("\n")}`);
}
