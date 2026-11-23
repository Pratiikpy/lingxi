/** D13: the cached exhaustive gate-budget measure is current for the game as it is (else run sim90.ts --write). */
import { describe, expect, it } from "vitest";
import { budgetChoiceKey } from "../scripts/sim90/budgetChoice";
import { BUDGET_CHOICE_CACHE } from "../scripts/sim90/budgetChoice.generated";

describe("the cached gate-budget measure (D13)", () => {
  it("matches the school's lessons, the budgets, the slots, the Mind share and the compiler it was measured on", () => {
    expect(BUDGET_CHOICE_CACHE.key, "stale: run npx tsx scripts/sim90.ts --write").toBe(budgetChoiceKey());
    expect(Object.keys(BUDGET_CHOICE_CACHE.value).sort()).toEqual(["bold", "curious", "gentle"]);
  });
});
