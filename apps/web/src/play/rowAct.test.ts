/** R8: a row's button is named by what it does and what to, the button's own words first. */
import { describe, expect, it } from "vitest";
import { rowAct, ruleSpoken } from "./rowAct";

describe("a row's button, named for a screen reader (R8)", () => {
  it("says the action and the thing, in the language's own punctuation", () => {
    expect(rowAct("Feed", "Rice ball", "en")).toBe("Feed: Rice ball");
    expect(rowAct("喂食", "饭团", "zh")).toBe("喂食：饭团");
    // the button's visible words come first, so its name still starts with what is drawn on it
    expect(rowAct("Buy · 5", "Apple", "en").startsWith("Buy · 5")).toBe(true);
  });

  it("says a rule as one sentence, with its kind first when that is shown", () => {
    expect(ruleSpoken(["something scary"], "explore", "en")).toBe("something scary, then explore.");
    expect(ruleSpoken(["fed", "peckish"], "eat", "en", "Instinct")).toBe("Instinct: fed and peckish, then eat.");
    expect(ruleSpoken(["有可怕的东西"], "到处看看", "zh", "本能")).toBe("本能：有可怕的东西，就到处看看。");
  });
});
