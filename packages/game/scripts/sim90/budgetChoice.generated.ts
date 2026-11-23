/* Written by scripts/sim90.ts --write (budgetChoice.ts); re-run it to reproduce. Do not edit by hand. */

import type { BudgetChoice } from "../../src";

export const BUDGET_CHOICE_CACHE: { key: string; value: BudgetChoice } = {
  "key": "{\"school\":[{\"label\":\"shares toys with friends\",\"when\":{\"event\":[1],\"joy\":[1,2,3]},\"then\":{\"want\":7,\"mood\":2,\"nudge\":6}},{\"label\":\"brave with you near\",\"when\":{\"event\":[3],\"owner\":[1]},\"then\":{\"want\":6,\"mood\":1,\"nudge\":1}},{\"label\":\"afternoon nap\",\"when\":{\"time\":[2],\"energy\":[0,1]},\"then\":{\"want\":3,\"mood\":1,\"nudge\":4}},{\"label\":\"happy to see you\",\"when\":{\"owner\":[1],\"action\":[0],\"joy\":[1,2,3]},\"then\":{\"want\":2,\"mood\":3,\"nudge\":5}},{\"label\":\"waits calmly\",\"when\":{\"hunger\":[1,2],\"action\":[0]},\"then\":{\"want\":0,\"mood\":1,\"nudge\":4}},{\"label\":\"asks for a bath\",\"when\":{\"clean\":[0,1]},\"then\":{\"want\":5,\"mood\":1}},{\"label\":\"morning explorer\",\"when\":{\"time\":[1],\"energy\":[2,3]},\"then\":{\"want\":4,\"mood\":2,\"nudge\":2}},{\"label\":\"thanks for food\",\"when\":{\"action\":[1]},\"then\":{\"want\":6,\"mood\":2,\"nudge\":6}}],\"budget\":{\"baby\":28,\"child\":30,\"teen\":32,\"adult\":48,\"elder\":60},\"slots\":{\"baby\":2,\"child\":2,\"teen\":4,\"adult\":6,\"elder\":8},\"share\":3,\"wide\":35,\"compiler\":[[296,373],[233,306],[248,327]]}",
  "value": {
    "gentle": {
      "teenSets": 70,
      "teenNoMind": 13,
      "teenFiveMind": 70,
      "adultSets": 28,
      "adultNoMind": 5,
      "adultFiveMind": 28,
      "elderAllEight": 65,
      "elderBudget": 60
    },
    "bold": {
      "teenSets": 70,
      "teenNoMind": 25,
      "teenFiveMind": 70,
      "adultSets": 28,
      "adultNoMind": 14,
      "adultFiveMind": 28,
      "elderAllEight": 61,
      "elderBudget": 60
    },
    "curious": {
      "teenSets": 70,
      "teenNoMind": 4,
      "teenFiveMind": 70,
      "adultSets": 28,
      "adultNoMind": 3,
      "adultFiveMind": 28,
      "elderAllEight": 66,
      "elderBudget": 60
    }
  }
};
