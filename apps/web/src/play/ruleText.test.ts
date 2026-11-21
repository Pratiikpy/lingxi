/**
 * B2: in a spar the rewind names the other pet's last move by what the fight sends on the action pins (spar2.ts), so a
 * care rule that reads "lights off" reads "foe rested", in both languages.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SPAR, MOVES, rulesOf } from "@lingxi/game";
import { FIGHT_VALUE_NAMES, MOVE_NAMES } from "./ruleText";

const WORD: Record<(typeof MOVES)[number], string> = { tap: "tapped", snack: "snacked", pounce: "pounced", rest: "rested", dodge: "dodged", guard: "guarded", charm: "charmed", gift: "gift" };

describe("the rewind's fight words (B2)", () => {
  it("name each move by the value the current fight sends for it, in English and Chinese", () => {
    const rules = rulesOf(CURRENT_SPAR)!;
    for (const [i, move] of MOVES.entries()) {
      const value = rules.moveAsAction[move];
      expect(FIGHT_VALUE_NAMES.action!.en[value], move).toContain(WORD[move]);
      expect(FIGHT_VALUE_NAMES.action!.zh[value], move).toContain(MOVE_NAMES.zh[i]!);
    }
  });
});
