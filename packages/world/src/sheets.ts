/**
 * Every sheet of conditions the game ships (quests, dailies, goals, gates), in one list so a single check covers
 * them all. A sheet is validated before the web build (scripts/check-sheets.ts) and in the tests, so a typo in an
 * item, room, resident or quest fails loudly with the row named instead of shipping a quest that cannot be done.
 */

import { type Condition, type SheetRefs, assertSheet } from "./conditions";

export interface Sheet {
  name: string;
  rows: ReadonlyArray<{ id: string; conditions: readonly Condition[] }>;
  refs?: SheetRefs;
}

/** The sheets in the game. Story quests and dailies join in plan 4.2, community goals in 4.10. */
export const SHEETS: Sheet[] = [];

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
