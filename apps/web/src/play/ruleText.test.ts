/**
 * B2: in a spar the rewind names the other pet's last move by what the fight sends on the action pins (spar2.ts), so a
 * care rule that reads "lights off" reads "foe rested", in both languages.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SPAR, MOVES, rulesOf } from "@lingxi/game";
import { FIGHT_VALUE_NAMES, MOVE_NAMES, MOVE_ORDER, MOVE_WORDS, chipsFor } from "./ruleText";
import { STARTERS } from "@lingxi/brain";

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

describe("a memory never shows as a bare number (B7)", () => {
  const p = STARTERS.gentle;
  const chips = (when: Record<string, number[]>, lang: "en" | "zh") => chipsFor(p, { when, then: { want: 3, mood: 0 } }, lang).when;
  it("the awake timer says minutes, and its top means or more", () => {
    expect(chips({ awake: [7] }, "en")).toEqual(["awake 7+ min"]);
    expect(chips({ awake: [7] }, "zh")).toEqual(["醒了 7 分钟以上"]);
    expect(chips({ awake: [2, 3] }, "en")).toEqual(["awake 2–3 min"]);
  });
  it("trust reads in words when the rule takes a third of it, and with its scale otherwise", () => {
    expect(chips({ trust: [0, 1, 2] }, "en")).toEqual(["low trust"]);
    expect(chips({ trust: [0, 1, 2] }, "zh")).toEqual(["还不太信任你"]);
    expect(chips({ trust: [6, 7] }, "en")).toEqual(["high trust"]);
    expect(chips({ trust: [1, 2, 3] }, "en")).toEqual(["trust 1–3 of 7"]);
    expect(chips({ trust: [1, 2, 3] }, "zh")).toEqual(["信任 1–3（满 7）"]);
  });
});

describe("one set of move words (B7)", () => {
  it("names the moves in the fight's own order, and every screen's words are the spar's", () => {
    expect([...MOVE_ORDER]).toEqual([...MOVES]);
    MOVES.forEach((m, i) => {
      expect(MOVE_WORDS[m][1].replace("！", "")).toBe(MOVE_NAMES.zh[i]);
      expect(MOVE_WORDS[m][0].replace("!", "").toLowerCase()).toBe(MOVE_NAMES.en[i]);
    });
    expect(MOVE_WORDS.rest[1]).toBe("休息");
    expect(MOVE_WORDS.dodge[1]).toBe("闪避");
    expect(MOVE_WORDS.charm[1]).toBe("卖萌");
  });
});
